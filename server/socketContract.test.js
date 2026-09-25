import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
} from '../shared/socketContract.js';

const readSources = (root, names) => names
  .map((name) => readFileSync(new URL(`${root}/${name}`, import.meta.url), 'utf8'))
  .join('\n');

const serverSource = readSources('.', [
  'app.js',
  'accountHandlers.js',
  'socialHandlers.js',
  'roomMembershipHandlers.js',
  'phasePetHandlers.js',
]);
const clientSource = readSources('../client/src', [
  'hooks/useGameSession.ts',
  'hooks/useSessionConnection.ts',
  'hooks/useOnlineFriends.ts',
  'components/AccountSettingsModal.tsx',
]);

describe('shared Socket.IO contract', () => {
  it.each(CLIENT_EVENT_NAMES)('%s is emitted by the client and handled by the server', (event) => {
    expect(clientSource).toMatch(new RegExp(`\\.emit\\(\\s*["']${event}["']`));
    expect(serverSource).toMatch(new RegExp(
      `(?:onPayload\\(socket,|socket\\.on\\()\\s*["']${event}["']`,
    ));
  });

  it.each(SERVER_EVENT_NAMES)('%s is emitted by the server and handled by the client', (event) => {
    expect(serverSource).toMatch(new RegExp(`\\.emit\\(\\s*["']${event}["']`));
    expect(clientSource).toMatch(new RegExp(`\\.on\\(\\s*["']${event}["']`));
  });
});
