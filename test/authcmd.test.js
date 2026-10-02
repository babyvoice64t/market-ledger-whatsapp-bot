import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthCommand } from '../authcmd.js';

test('parses "login <id> <password>"', () => {
  assert.deepEqual(parseAuthCommand('login ali123 secret1'), { cmd: 'login', username: 'ali123', password: 'secret1' });
});

test('login is case-insensitive and trims spaces', () => {
  assert.deepEqual(parseAuthCommand('  LOGIN  ali123   secret1  '), { cmd: 'login', username: 'ali123', password: 'secret1' });
});

test('login password may contain spaces', () => {
  assert.deepEqual(parseAuthCommand('login ali123 my pass 123'), { cmd: 'login', username: 'ali123', password: 'my pass 123' });
});

test('login without password is not a command', () => {
  assert.equal(parseAuthCommand('login ali123'), null);
  assert.equal(parseAuthCommand('login'), null);
});

test('parses logout', () => {
  assert.deepEqual(parseAuthCommand('logout'), { cmd: 'logout' });
  assert.deepEqual(parseAuthCommand('LOGOUT'), { cmd: 'logout' });
});

test('parses me / whoami', () => {
  assert.deepEqual(parseAuthCommand('me'), { cmd: 'me' });
  assert.deepEqual(parseAuthCommand('whoami'), { cmd: 'me' });
});

test('ordinary text is not an auth command', () => {
  assert.equal(parseAuthCommand('50000'), null);
  assert.equal(parseAuthCommand('imran ali sales 5000'), null);
  assert.equal(parseAuthCommand('haan'), null);
  assert.equal(parseAuthCommand('cancel'), null);
  assert.equal(parseAuthCommand(''), null);
  assert.equal(parseAuthCommand('please login me'), null);
});
