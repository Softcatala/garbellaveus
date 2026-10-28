import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { EmailSubscription } from './email-subscription.entity';

// Many-to-many between anonymous usernames (localStorage UUIDs) and confirmed
// addresses: one UUID may confirm several addresses and one address may be
// confirmed from several browsers.
@Entity('email_uuid_links')
@Unique(['username', 'subscriptionId'])
@Index(['username'])
export class EmailUuidLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  username: string;

  @Column({ name: 'subscription_id' })
  subscriptionId: number;

  @ManyToOne(() => EmailSubscription, (s) => s.links, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: EmailSubscription;
}
