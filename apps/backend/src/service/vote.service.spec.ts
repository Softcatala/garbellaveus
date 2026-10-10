import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VoteService } from './vote.service';
import { Vote } from '../domain/vote.entity';
import { Clip } from '../domain/clip.entity';
import { Transcription } from '../domain/transcription.entity';
import { MetricsService } from '../observability/metrics.service';

describe('VoteService', () => {
  let service: VoteService;
  let repo: Repository<Vote>;
  let transcriptions: Repository<Transcription>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          // Vote's @ManyToOne(Clip) needs the full entity graph registered,
          // otherwise TypeORM's metadata build fails in a way that
          // @nestjs/typeorm's retry logic reports as a misleading
          // "sqlite3 not installed" error.
          entities: [Vote, Clip, Transcription],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Vote, Clip, Transcription]),
      ],
      providers: [VoteService, MetricsService],
    }).compile();

    service = module.get(VoteService);
    repo = module.get(getRepositoryToken(Vote));
    transcriptions = module.get(getRepositoryToken(Transcription));

    // Vote.clipId is a real FK against clips, so seed the clips these tests vote on.
    const clips: Repository<Clip> = module.get(getRepositoryToken(Clip));
    await clips.save(clips.create({ clipId: 'clip-1', gender: 'female', duration: 3600 })); // 1h
    await clips.save(clips.create({ clipId: 'clip-2', detectedDialect: 'central', duration: 1800 })); // 0.5h
    // Never voted on — should still count toward totalHours but not evaluated/golden hours.
    await clips.save(clips.create({ clipId: 'clip-3', duration: 3600 })); // 1h
  });

  it('lets a user hold independent votes on competing candidates within one dimension', async () => {
    // Downvoting the current gender and upvoting the proposed alternative used to
    // collide on the old (clipId, dimension, username) unique constraint.
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'female', username: 'alice', value: -1 });
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'alice', value: 1 });

    const rows = await repo.find({ where: { clipId: 'clip-1', username: 'alice' } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.targetId === 'female')?.value).toBe(-1);
    expect(rows.find((r) => r.targetId === 'male')?.value).toBe(1);
  });

  it('upserts in place when the same user votes again on the same target', async () => {
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'alice', value: 1 });
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'alice', value: -1 });

    const rows = await repo.find({ where: { clipId: 'clip-1', username: 'alice', targetId: 'male' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(-1);
  });

  it('raises a competing gender candidate to golden once two evaluators confirm it', async () => {
    // dave downvotes the original 'female' label and raises 'male' as the alternative
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'female', username: 'dave', value: -1 });
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'dave', value: 1 });
    // erin independently confirms 'male'
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'erin', value: 1 });

    const summary = await service.summaryForClip('clip-1');
    const male = summary.find((s) => s.targetId === 'male');
    const female = summary.find((s) => s.targetId === 'female');

    expect(male).toMatchObject({ netVotes: 2, isGolden: true });
    expect(female).toMatchObject({ netVotes: -1, isGolden: false });
  });

  it('supports a dialect candidate chosen from a picker the same way', async () => {
    await service.cast({ clipId: 'clip-2', dimension: 'dialect', targetId: 'central', username: 'alice', value: -1 });
    await service.cast({ clipId: 'clip-2', dimension: 'dialect', targetId: 'valencian', username: 'alice', value: 1 });
    await service.cast({ clipId: 'clip-2', dimension: 'dialect', targetId: 'valencian', username: 'bob', value: 1 });

    const summary = await service.summaryForClip('clip-2');
    const valencian = summary.find((s) => s.targetId === 'valencian');

    expect(valencian).toMatchObject({ netVotes: 2, isGolden: true });
  });

  it('excludes scripts/infer_dialect.py\'s bulk-vote username from stats but still counts it in summaryForClip', async () => {
    // Bot suggests a dialect on clip-2 — nobody else has weighed in yet.
    await service.cast({ clipId: 'clip-2', dimension: 'dialect', targetId: 'valencian', username: 'derivat-de-poblacio', value: 1 });
    // Real evaluator does independent work on clip-1.
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'alice', value: 1 });

    const stats = await service.stats();
    const dialect = stats.dimensions.find((d) => d.dimension === 'dialect');
    const gender = stats.dimensions.find((d) => d.dimension === 'gender');

    // The bot-only vote shouldn't make clip-2 look human-evaluated in stats...
    expect(dialect).toBeUndefined();
    expect(gender).toMatchObject({ evaluated: 1, golden: 0 });

    // ...but it still surfaces as a real candidate for a human to confirm/reject.
    const summary = await service.summaryForClip('clip-2');
    expect(summary.find((s) => s.targetId === 'valencian')).toMatchObject({ netVotes: 1, isGolden: false });
  });

  it('weights evaluated/golden hours by clip duration, and totalHours covers every clip regardless of votes', async () => {
    // clip-1 (1h): reaches golden gender.
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'dave', value: 1 });
    await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: 'male', username: 'erin', value: 1 });
    // clip-2 (0.5h): evaluated but not yet golden.
    await service.cast({ clipId: 'clip-2', dimension: 'gender', targetId: 'female', username: 'alice', value: 1 });
    // clip-3 (1h) is never voted on.

    const stats = await service.stats();
    const gender = stats.dimensions.find((d) => d.dimension === 'gender');

    expect(gender).toMatchObject({ evaluated: 2, golden: 1, evaluatedHours: 1.5, goldenHours: 1 });
    // clip-1 + clip-2 + clip-3 = 1 + 0.5 + 1 = 2.5h, including the never-voted-on clip.
    expect(stats.totalHours).toBe(2.5);
  });
  describe('identical transcription texts share one voting target', () => {
    const seed = async () => {
      const gemini = await transcriptions.save(transcriptions.create({ clipId: 'clip-1', origin: 'gemini', text: 'Same corrected text' }));
      const other = await transcriptions.save(transcriptions.create({ clipId: 'clip-1', origin: 'claude', text: 'Something else' }));
      const human = await transcriptions.save(transcriptions.create({ clipId: 'clip-1', origin: 'human', text: 'Same corrected text' }));
      return { gemini, other, human };
    };

    it('redirects a vote on a later duplicate to the oldest row with the same text', async () => {
      const { gemini, human } = await seed();

      const saved = await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(human.id), username: 'alice', value: 1 });

      expect(saved.targetId).toBe(String(gemini.id));
      const summary = await service.summaryForClip('clip-1');
      expect(summary).toEqual([expect.objectContaining({ targetId: String(gemini.id), netVotes: 1 })]);
    });

    it('accumulates a correction vote and later confirmations on the same target', async () => {
      const { gemini, human } = await seed();

      await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(human.id), username: 'alice', value: 1 });
      await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(gemini.id), username: 'bob', value: 1 });

      const summary = await service.summaryForClip('clip-1');
      expect(summary).toEqual([expect.objectContaining({ targetId: String(gemini.id), netVotes: 2, isGolden: true })]);
    });

    it('does not count the same reviewer twice when they vote via different duplicate ids', async () => {
      const { gemini, human } = await seed();

      await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(gemini.id), username: 'alice', value: 1 });
      await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(human.id), username: 'alice', value: 1 });

      const rows = await repo.find({ where: { clipId: 'clip-1', dimension: 'transcription' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(1);
    });

    it('leaves votes on distinct texts on their own ids', async () => {
      const { other } = await seed();

      const saved = await service.cast({ clipId: 'clip-1', dimension: 'transcription', targetId: String(other.id), username: 'alice', value: -1 });

      expect(saved.targetId).toBe(String(other.id));
    });

    it('does not rewrite non-transcription targets that happen to look numeric', async () => {
      await seed();

      const saved = await service.cast({ clipId: 'clip-1', dimension: 'gender', targetId: '3', username: 'alice', value: 1 });

      expect(saved.targetId).toBe('3');
    });

    describe('reconcileDuplicateTranscriptionVotes', () => {
      const vote = (targetId: string, username: string, value: number, createdAt: string) =>
        repo.save(repo.create({ clipId: 'clip-1', dimension: 'transcription', targetId, username, value, createdAt }));

      it('moves votes from duplicate rows onto the canonical id', async () => {
        const { gemini, human } = await seed();
        await vote(String(gemini.id), 'bob', 1, '2026-01-01');
        await vote(String(human.id), 'alice', 1, '2026-01-02');

        await service.reconcileDuplicateTranscriptionVotes();

        const summary = await service.summaryForClip('clip-1');
        expect(summary).toEqual([expect.objectContaining({ targetId: String(gemini.id), netVotes: 2, isGolden: true })]);
      });

      it('keeps only a reviewer\'s most recent opinion when they voted on both ids', async () => {
        const { gemini, human } = await seed();
        await vote(String(gemini.id), 'alice', -1, '2026-01-01');
        await vote(String(human.id), 'alice', 1, '2026-01-02');

        await service.reconcileDuplicateTranscriptionVotes();

        const rows = await repo.find({ where: { clipId: 'clip-1', dimension: 'transcription' } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ targetId: String(gemini.id), username: 'alice', value: 1 });
      });

      it('is idempotent and leaves unrelated votes alone', async () => {
        const { gemini, other, human } = await seed();
        await vote(String(human.id), 'alice', 1, '2026-01-02');
        await vote(String(other.id), 'bob', -1, '2026-01-03');

        await service.reconcileDuplicateTranscriptionVotes();
        await service.reconcileDuplicateTranscriptionVotes();

        const rows = await repo.find({ where: { clipId: 'clip-1' }, order: { id: 'ASC' } });
        expect(rows.map((r) => [r.targetId, r.username, r.value])).toEqual([
          [String(gemini.id), 'alice', 1],
          [String(other.id), 'bob', -1],
        ]);
      });
    });
  });
});
