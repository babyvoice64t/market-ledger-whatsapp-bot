import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActivateCommand } from '../botcmd.js';

test('parses "activate <id> <password>"', () => {
  assert.deepEqual(parseActivateCommand('activate ali123 secret1'), { username: 'ali123', password: 'secret1' });
});

test('activate is case-insensitive and trims', () => {
  assert.deepEqual(parseActivateCommand('  ACTIVATE  ali123   secret1  '), { username: 'ali123', password: 'secret1' });
});

test('password may contain spaces', () => {
  assert.deepEqual(parseActivateCommand('activate ali123 my pass 123'), { username: 'ali123', password: 'my pass 123' });
});

test('bare "activate" returns usage hint', () => {
  assert.deepEqual(parseActivateCommand('activate'), { usage: true });
  assert.deepEqual(parseActivateCommand('  activate  '), { usage: true });
});

test('activate without password is not a command', () => {
  assert.equal(parseActivateCommand('activate ali123'), null);
});

test('ordinary text is not an activate command', () => {
  assert.equal(parseActivateCommand('50000'), null);
  assert.equal(parseActivateCommand('imran ali sales 5000'), null);
  assert.equal(parseActivateCommand('login ali123 pw'), null);
  assert.equal(parseActivateCommand('please activate me'), null);
  assert.equal(parseActivateCommand(''), null);
});
