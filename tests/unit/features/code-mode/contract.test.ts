import { describe, expect, it } from 'vitest';
import { listBridgeMethodSummaries, listBridgeMethodSummariesForAuthority } from '../../../../src/features/code-mode/bridge/contract';

const expectedPublicMethodKeys = [
  'discord.channels.get',
  'discord.channels.list',
  'discord.messages.send',
  'discord.messages.reply',
  'discord.messages.edit',
  'discord.reactions.add',
  'discord.reactions.remove',
  'discord.threads.create',
  'discord.threads.update',
  'discord.threads.join',
  'discord.threads.leave',
  'discord.threads.addMember',
  'discord.threads.removeMember',
  'discord.threads.archive',
  'discord.threads.reopen',
  'discord.members.get',
  'discord.roles.get',
  'discord.roles.list',
  'discord.roles.add',
  'discord.roles.remove',
  'history.get',
  'history.recent',
  'history.search',
  'context.summary.get',
  'context.profile.get',
  'artifacts.list',
  'artifacts.get',
  'artifacts.create',
  'artifacts.update',
  'artifacts.publish',
  'approvals.get',
  'approvals.list',
  'admin.instructions.get',
  'admin.instructions.update',
  'admin.runtime.getCapabilities',
  'moderation.cases.list',
  'moderation.cases.get',
  'moderation.cases.acknowledge',
  'moderation.cases.resolve',
  'moderation.notes.create',
  'moderation.messages.delete',
  'moderation.messages.bulkDelete',
  'moderation.reactions.removeUser',
  'schedule.jobs.get',
  'schedule.jobs.list',
  'schedule.jobs.create',
  'schedule.jobs.update',
  'schedule.jobs.pause',
  'schedule.jobs.resume',
  'schedule.jobs.cancel',
  'schedule.jobs.run',
  'schedule.jobs.runs',
  'http.fetch',
  'workspace.read',
  'workspace.write',
  'workspace.append',
  'workspace.list',
  'workspace.search',
  'workspace.delete',
].sort();

describe('bridge contract manifest', () => {
  it('exposes the full bounded SDK surface in one summary manifest', () => {
    const methods = listBridgeMethodSummaries();
    const keys = methods.map((method) => method.key).sort();

    expect(keys).toEqual(expectedPublicMethodKeys);
    expect(methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'discord.messages.edit',
          summary: expect.stringContaining('Edit'),
          mutability: 'write',
          access: 'public',
          approvalMode: 'required',
          requiredArgs: ['channelId', 'messageId', 'content'],
          optionalArgs: [],
        }),
        expect.objectContaining({
          key: 'admin.runtime.getCapabilities',
          mutability: 'read',
          access: 'public',
          approvalMode: 'none',
          requiredArgs: [],
          optionalArgs: [],
        }),
        expect.objectContaining({
          key: 'workspace.write',
          mutability: 'write',
          access: 'public',
          approvalMode: 'required',
          requiredArgs: ['path', 'content'],
        }),
      ]),
    );
  });

  it('filters privileged methods out of member capability views', () => {
    const memberMethods = listBridgeMethodSummariesForAuthority('member');
    const keys = memberMethods.map((method) => method.key).sort();

    expect(keys).toEqual([
      'admin.runtime.getCapabilities',
      'artifacts.create',
      'artifacts.get',
      'artifacts.list',
      'artifacts.publish',
      'artifacts.update',
      'context.profile.get',
      'context.summary.get',
      'discord.channels.get',
      'discord.channels.list',
      'discord.messages.edit',
      'discord.messages.reply',
      'discord.messages.send',
      'discord.reactions.add',
      'discord.reactions.remove',
      'discord.threads.join',
      'discord.threads.leave',
      'history.get',
      'history.recent',
      'history.search',
      'http.fetch',
      'workspace.append',
      'workspace.delete',
      'workspace.list',
      'workspace.read',
      'workspace.search',
      'workspace.write',
    ]);
    expect(memberMethods).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ key: 'admin.instructions.get' }),
        expect.objectContaining({ key: 'moderation.cases.list' }),
        expect.objectContaining({ key: 'schedule.jobs.list' }),
      ]),
    );
  });
});
