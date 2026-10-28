import { Controller, Get, Query, Param, NotFoundException } from '@nestjs/common';
import { ClipService } from '../service/clip.service';
import { TranscriptionService } from '../service/transcription.service';
import { VoteService } from '../service/vote.service';
import { deduplicateTranscriptions } from '../service/unique-transcriptions';

export type { UniqueTranscription } from '../service/unique-transcriptions';

@Controller('evaluate')
export class EvaluateController {
  constructor(
    private readonly clipService: ClipService,
    private readonly transcriptionService: TranscriptionService,
    private readonly voteService: VoteService,
  ) {}

  @Get('clip/:clipId')
  async forClip(
    @Param('clipId') clipId: string,
    @Query('username') username = '',
  ) {
    const result = await this.clipService.findOne(clipId).catch(() => null);
    if (!result) throw new NotFoundException(`Clip ${clipId} not found`);
    const rawTranscriptions = await this.transcriptionService.findByClip(clipId);
    const uniqueTranscriptions = deduplicateTranscriptions(rawTranscriptions);
    const votes = await this.voteService.summaryForClip(clipId);
    const userVotes = username ? await this.voteService.userVotesForClip(clipId, username) : [];
    return { clip: result.clip, uniqueTranscriptions, votes, userVotes };
  }

  @Get('next')
  async next(
    @Query('username') username: string,
    @Query('dimension') dimension = 'transcription',
    @Query('skip') skipRaw = '',
  ) {
    const skipIds = skipRaw ? skipRaw.split(',').filter(Boolean) : [];

    const clip = await this.clipService.nextForEvaluation(username, dimension, skipIds);
    if (!clip) return { done: true };

    const rawTranscriptions = await this.transcriptionService.findByClip(clip.clipId);
    const uniqueTranscriptions = deduplicateTranscriptions(rawTranscriptions);

    const votes = await this.voteService.summaryForClip(clip.clipId);
    const userVotes = username ? await this.voteService.userVotesForClip(clip.clipId, username) : [];

    return { clip, uniqueTranscriptions, votes, userVotes };
  }
}
