/**
 * Identity resolution rules, without a chain. The ENS resolver is replaced by a
 * stub, so these tests pin the fail-closed table in service.ts: which answers
 * come from the chain, when a local row may answer, and when nothing may.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Agent, Policy } from '@faregate/shared';

import { GatewayStore } from '../store.ts';
import { EnsResolverError, type EnsPassport, type EnsPassportResolver } from './ens.ts';
import { EnsIdentityService } from './service.ts';

const PARENT = 'agents.faregate.eth';
const NOW = new Date('2026-09-11T00:00:00.000Z');

type Outcome = EnsPassport | null | 'unreachable';

function stubResolver(outcome: Outcome): EnsPassportResolver {
  return {
    describe: () => 'stub resolver',
    resolve: async () => {
      if (outcome === 'unreachable') {
        throw new EnsResolverError('rpc_error', 'ENS resolution failed: stub outage');
      }
      return outcome;
    },
  } as unknown as EnsPassportResolver;
}

function passportFor(id: string, source: Agent['source'], status: Agent['status'] = 'active'): EnsPassport {
  const agent: Agent = {
    id,
    label: id,
    owner: '0x0000000000000000000000000000000000000000',
    status,
    createdAt: NOW.toISOString(),
    expiresAt: null,
    source,
  };
  const policy: Policy = {
    agentId: id,
    allowedResources: ['wallet.balances'],
    maxCostPerQueryUsd: 1,
    dailyLimitUsd: 1,
    humanApprovalAboveUsd: 1,
    expiresAt: null,
  };
  return { agent, policy };
}

function storeWithLocal(...ids: string[]): GatewayStore {
  const store = new GatewayStore();
  for (const id of ids) {
    const { agent, policy } = passportFor(id, 'local');
    store.putAgent(agent);
    store.putPolicy(policy);
  }
  return store;
}

test('a passport name fails closed when the chain is unreachable, even with a local copy', async () => {
  const id = `research.${PARENT}`;
  const service = new EnsIdentityService(stubResolver('unreachable'), storeWithLocal(id), PARENT);
  const resolved = await service.resolve(id, NOW);
  assert.equal(resolved.agent, null);
  assert.equal(resolved.source, 'none');
  assert.match(resolved.note ?? '', /^ens_unavailable/);
});

test('a passport name with no passport onchain is refused, and a local row does not resurrect it', async () => {
  const id = `ghost.${PARENT}`;
  const service = new EnsIdentityService(stubResolver(null), storeWithLocal(id), PARENT);
  const resolved = await service.resolve(id, NOW);
  assert.equal(resolved.agent, null);
  assert.equal(resolved.note, 'no_passport_on_ens');
});

test('a revocation read from ENS wins over an active local copy', async () => {
  const id = `trial.${PARENT}`;
  const store = storeWithLocal(id);
  const service = new EnsIdentityService(stubResolver(passportFor(id, 'ens', 'revoked')), store, PARENT);
  const resolved = await service.resolve(id, NOW);
  assert.equal(resolved.source, 'ens');
  assert.equal(resolved.agent?.status, 'revoked');
  // The display copy follows the chain.
  assert.equal(store.getAgent(id)?.status, 'revoked');
  assert.equal(store.getAgent(id)?.source, 'ens');
});

test('a name outside the passport parent may fall back to the local store when ENS is down', async () => {
  const id = 'helper.local.test';
  const service = new EnsIdentityService(stubResolver('unreachable'), storeWithLocal(id), PARENT);
  const resolved = await service.resolve(id, NOW);
  assert.equal(resolved.source, 'local');
  assert.equal(resolved.agent?.id, id);
  assert.match(resolved.note ?? '', /^ens_unavailable/);
});

test('the gateway cannot revoke a passport under the parent', () => {
  const service = new EnsIdentityService(stubResolver(null), storeWithLocal(), PARENT);
  assert.equal(service.canRevokeLocally(`research.${PARENT}`), false);
  assert.equal(service.canRevokeLocally('helper.local.test'), true);
});
