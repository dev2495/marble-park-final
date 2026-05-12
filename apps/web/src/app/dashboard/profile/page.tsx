'use client';

import { useEffect, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, ImagePlus, KeyRound, Loader2, ShieldCheck, Trash2, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/user-avatar';
import { QueryErrorBanner } from '@/components/query-state';
import { Panel, GreetingStrip } from '@/components/dashboard/primitives';

const ME = gql`
  query Me {
    me {
      id name email phone role active avatarUrl bio passwordChangedAt createdAt
    }
  }
`;

const UPDATE_PROFILE = gql`
  mutation UpdateMyProfile($input: UpdateMyProfileInput!) {
    updateMyProfile(input: $input) {
      id name email phone avatarUrl bio
    }
  }
`;

const CHANGE_PASSWORD = gql`
  mutation ChangeMyPassword($input: ChangeMyPasswordInput!) {
    changeMyPassword(input: $input) {
      ok passwordChangedAt
    }
  }
`;

function daysAgo(d?: string | null): string {
  if (!d) return 'never';
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return 'never';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export default function ProfilePage() {
  const { data, loading, error, refetch } = useQuery(ME);
  const [updateProfile, { loading: saving, error: saveError }] = useMutation(UPDATE_PROFILE, {
    onCompleted: (result) => {
      // Reflect updated name in localStorage so the sidebar picks it up.
      try {
        const stored = JSON.parse(localStorage.getItem('user') || 'null') || {};
        localStorage.setItem('user', JSON.stringify({ ...stored, ...result.updateMyProfile }));
      } catch {}
      setProfileSaved(Date.now());
      refetch();
    },
  });
  const [changePassword, { loading: changing, error: passwordError }] = useMutation(CHANGE_PASSWORD);

  const me = data?.me;

  const [profile, setProfile] = useState({ name: '', email: '', phone: '', bio: '', avatarUrl: '' });
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [profileSaved, setProfileSaved] = useState<number | null>(null);
  const [passwordSaved, setPasswordSaved] = useState<number | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [passwordValidationError, setPasswordValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setProfile({
      name: me.name || '',
      email: me.email || '',
      phone: me.phone || '',
      bio: me.bio || '',
      avatarUrl: me.avatarUrl || '',
    });
  }, [me]);

  async function handleAvatarUpload(file: File | null) {
    if (!file) return;
    setUploadError(null);
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope', 'product-image'); // reuse the image upload path
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.publicUrl) throw new Error(json.error || 'Upload failed');
      setProfile((cur) => ({ ...cur, avatarUrl: json.publicUrl }));
    } catch (err) {
      setUploadError((err as any)?.message || 'Upload failed');
    } finally {
      setUploadingAvatar(false);
    }
  }

  function handleProfileSubmit(event: React.FormEvent) {
    event.preventDefault();
    updateProfile({
      variables: {
        input: {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          bio: profile.bio || null,
          avatarUrl: profile.avatarUrl || null,
        },
      },
    });
  }

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPasswordValidationError(null);
    if (pwd.newPassword !== pwd.confirm) {
      setPasswordValidationError('New password and confirmation do not match.');
      return;
    }
    if (pwd.newPassword.length < 8) {
      setPasswordValidationError('New password must be at least 8 characters.');
      return;
    }
    try {
      const { data: result, errors } = await changePassword({
        variables: { input: { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword } },
      });
      if (errors?.length) {
        setPasswordValidationError(errors.map((e) => e.message).join(' • '));
        return;
      }
      if (result?.changeMyPassword?.ok) {
        setPasswordSaved(Date.now());
        setPwd({ currentPassword: '', newPassword: '', confirm: '' });
        refetch();
      }
    } catch (err) {
      // Apollo mutate throws on network failure; the passwordError is shown by the banner.
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  if (error && !me) {
    return <QueryErrorBanner error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <GreetingStrip
        role={me?.role || 'user'}
        name={me?.name}
        subtitle="Update your account details, change your password, and personalise your avatar."
      />

      <section className="grid gap-3 xl:grid-cols-[1fr_2fr]">
        {/* ── Profile card (avatar + identity at a glance) ── */}
        <div className="mp-card rounded-r5 p-6">
          <div className="flex flex-col items-center text-center">
            <UserAvatar user={{ id: me?.id, name: profile.name || me?.name, email: me?.email, avatarUrl: profile.avatarUrl || me?.avatarUrl }} size="xl" ringed />
            <h2 className="mt-4 font-display text-xl font-bold text-[#18181b]">{profile.name || me?.name || 'Your profile'}</h2>
            <p className="mt-1 text-xs text-[#71717a] capitalize">{(me?.role || '').replace('_', ' ')}</p>
            <p className="mt-3 text-[11px] text-[#52525b]"><span className="font-semibold text-[#18181b]">Member since</span> · {me?.createdAt ? new Date(me.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '—'}</p>
            <p className="text-[11px] text-[#52525b]"><span className="font-semibold text-[#18181b]">Password</span> · {daysAgo(me?.passwordChangedAt)}</p>

            <div className="mt-5 flex w-full flex-col gap-2">
              <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-[#e4e4e7] bg-white px-3 py-2 text-xs font-medium text-[#27272a] transition-colors hover:bg-[#f4f4f5]">
                {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploadingAvatar ? 'Uploading…' : profile.avatarUrl ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/*" className="hidden" onChange={(event) => handleAvatarUpload(event.target.files?.[0] ?? null)} />
              </label>
              {profile.avatarUrl ? (
                <button type="button" onClick={() => setProfile((cur) => ({ ...cur, avatarUrl: '' }))} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#e4e4e7] bg-white px-3 py-2 text-xs font-medium text-[#b91c1c] transition-colors hover:bg-[#fef2f2]">
                  <Trash2 className="h-3.5 w-3.5" /> Remove photo
                </button>
              ) : null}
            </div>

            {uploadError ? <p role="alert" className="mt-3 w-full rounded-md border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">{uploadError}</p> : null}
          </div>
        </div>

        {/* ── Personal details form ── */}
        <Panel title="Personal details" subtitle="Update your name, contact and short bio" tone="brand">
          <form onSubmit={handleProfileSubmit} className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Full name</span>
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Email</span>
              <Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} type="email" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Phone</span>
              <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Role</span>
              <Input value={(me?.role || '').replace('_', ' ')} disabled />
            </label>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="text-xs font-medium text-[#52525b]">Short bio</span>
              <textarea
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value.slice(0, 280) })}
                rows={3}
                maxLength={280}
                placeholder="One sentence about you (≤ 280 chars). Shown on the team page."
                className="min-h-[5rem] w-full rounded-md border border-[#e4e4e7] bg-white px-3 py-2 text-sm text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-2 focus:ring-[rgba(37,99,235,0.35)]"
              />
              <p className="text-[10px] text-[#a1a1aa]">{profile.bio.length}/280</p>
            </label>
            <div className="md:col-span-2 flex items-center justify-between gap-3">
              {saveError ? <QueryErrorBanner error={saveError} /> : null}
              {profileSaved ? <span className="inline-flex items-center gap-1 text-xs font-medium text-[#047857]"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span> : <span />}
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </form>
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <Panel title="Change password" subtitle={`Last changed ${daysAgo(me?.passwordChangedAt)}`} tone="warning">
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Current password</span>
              <Input value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} type="password" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">New password</span>
              <Input value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} type="password" required minLength={8} />
              <p className="text-[10px] text-[#a1a1aa]">At least 8 characters. Use letters, numbers and a symbol for best strength.</p>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#52525b]">Confirm new password</span>
              <Input value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} type="password" required minLength={8} />
            </label>
            {passwordValidationError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">{passwordValidationError}</p> : null}
            {passwordError ? <QueryErrorBanner error={passwordError} /> : null}
            <div className="flex items-center justify-between gap-3">
              {passwordSaved ? <span className="inline-flex items-center gap-1 text-xs font-medium text-[#047857]"><CheckCircle2 className="h-3.5 w-3.5" /> Password updated</span> : <span />}
              <Button type="submit" variant="warning" disabled={changing}><KeyRound className="mr-1.5 h-4 w-4" /> {changing ? 'Updating…' : 'Update password'}</Button>
            </div>
          </form>
        </Panel>

        <Panel title="Security & sessions" subtitle="Account safety overview" tone="success">
          <ul className="space-y-3">
            <li className="flex items-start gap-3 rounded-r3 border border-[#f4f4f5] bg-white p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#d1fae5] text-[#047857]">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#18181b]">Password is set</p>
                <p className="text-xs text-[#71717a]">Last changed {daysAgo(me?.passwordChangedAt)}. We recommend rotating every 90 days.</p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-r3 border border-[#f4f4f5] bg-white p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#dbeafe] text-[#1d4ed8]">
                <UserCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#18181b]">Account active</p>
                <p className="text-xs text-[#71717a]">{me?.active ? 'Your account is enabled.' : 'Your account is disabled.'} Created {me?.createdAt ? new Date(me.createdAt).toLocaleDateString('en-IN') : '—'}.</p>
              </div>
            </li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}
