import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { EmailUuidLink } from './email-uuid-link.entity';

// A confirmed (double opt-in) email address. Rows only exist after the person
// clicked the confirmation link — pending requests live in a signed token, never
// in the database. Deleting a row (unsubscribe) cascades to its uuid links, which
// is all that ties an address to anyone's votes; the votes themselves only ever
// carry the anonymous username.
@Entity('email_subscriptions')
export class EmailSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  // Stored lowercased and trimmed.
  @Column({ unique: true })
  email: string;

  @Column({ name: 'consented_at' })
  consentedAt: string;

  @Column({ name: 'consent_version' })
  consentVersion: string;

  @Column({ name: 'reminder_sent_at', type: 'varchar', nullable: true })
  reminderSentAt: string | null;

  // Reminders sent since the person last voted; capped so silence pauses them.
  @Column('integer', { name: 'reminder_count', default: 0 })
  reminderCount: number;

  @OneToMany(() => EmailUuidLink, (l) => l.subscription)
  links: EmailUuidLink[];
}
