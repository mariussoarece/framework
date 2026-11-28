// Shapes of the database rows the app reads (see db/migrations).
export type Role = 'super_admin' | 'owner' | 'client';
export type Plan = 'none' | 'commission' | 'flat';
export type VideoQuality = 'auto' | '720' | '1080';

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  phone?: string | null;            // migration 018; filled in by the client in Settings
  language: 'en' | 'ro';
  role: Role;
  organization_id: string | null;
  video_quality: VideoQuality;
};

export type Organization = {
  id: string;
  name: string;
  join_code: string;
  is_default: boolean;
  timezone: string;
  plan: Plan;
  status: 'trial' | 'active' | 'paused' | 'closed';
  trial_ends_at: string;
};

export type HomeSettings = {
  organization_id: string;
  theme_key: string;
  background_media_id: string | null;
  foreground_media_id: string | null;
  front_size?: string | null;          // 'small' | 'medium' | 'large' (migration 010)
  description: RichDoc | null;
};

export type HomeButton = {
  id: string;
  type: 'scheduling' | 'workouts';
  label: string;
  icon: string;
  color: string;
  position: number;
};

// TipTap JSON (what the owner's editor saves)
export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};
export type RichDoc = RichNode;
