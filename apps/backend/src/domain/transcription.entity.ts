import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Clip } from './clip.entity';

@Entity('transcriptions')
// Every clip lookup (Explore list, clip detail, voting) filters on clip_id;
// without this each one scans the whole table.
@Index(['clipId'])
export class Transcription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'clip_id' })
  clipId: string;

  @ManyToOne(() => Clip, (c) => c.transcriptions)
  @JoinColumn({ name: 'clip_id' })
  clip: Clip;

  // origin: 'claude', 'gemini', 'human', 'candidate_1', 'candidate_2'
  @Column()
  origin: string;

  @Column('text')
  text: string;

  // JSON string for model-detected metadata (e.g. {"gender": "female", "dialect": "valencian"})
  @Column('text', { nullable: true })
  metadata: string;

  @Column({ name: 'created_at', nullable: true })
  createdAt: string;
}
