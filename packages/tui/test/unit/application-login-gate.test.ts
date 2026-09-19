import { describe, expect, it, vi } from 'vitest';

import {
  MINIMAX_CODE_HEADLESS_LOGIN_REQUIRED_MESSAGE,
  TuiLoginRequiredError,
  requireTuiAccountLogin,
  requireTuiAgentAccess,
  tuiAccountNeedsLoginPrompt,
  tuiAgentAccessNeedsLogin,
} from '../../src/application/login-gate.js';

describe('welcome login prompt', () => {
  it('stays silent when the selected model is a BYOK custom provider', () => {
    const account = {
      status: 'needs-login' as const,
      defaultModel: 'custom_provider:deepseek/deepseek-flash',
      providerId: 'custom_provider:deepseek',
      authMode: 'api-key',
      managedTokenPresent: false,
      warnings: [],
    };

    expect(tuiAccountNeedsLoginPrompt(account)).toBe(false);
    // Cloud/Agent features still require the MiniMax account; only the welcome nag is dropped.
    expect(tuiAgentAccessNeedsLogin(account)).toBe(true);
  });

  it('keeps asking when the selected model is managed', () => {
    const account = {
      status: 'needs-login' as const,
      defaultModel: 'minimax/MiniMax-M3',
      providerId: 'minimax',
      authMode: 'managed-login',
      managedTokenPresent: false,
      warnings: [],
    };

    expect(tuiAccountNeedsLoginPrompt(account)).toBe(true);
  });
});

describe('MiniMax login gate', () => {
  it.each([
    { authMode: 'byok', modelSource: 'byok' as const, managedTokenPresent: false },
    { authMode: 'byok', modelSource: 'byok' as const, managedTokenPresent: undefined },
    {
      authMode: 'managed-login',
      modelSource: 'byok' as const,
      managedTokenPresent: false,
    },
  ])('allows an unauthenticated BYOK Agent Run: %s', async (selection) => {
    const account = { status: 'ready' as const, ...selection, warnings: [] };
    const getAccountStatus = vi.fn(async () => account);

    await expect(requireTuiAgentAccess({ getAccountStatus }, 'session-1')).resolves.toBe(
      account,
    );
    expect(getAccountStatus).toHaveBeenCalledWith('session-1', undefined);
  });

  it('accepts a shared managed token for a managed model', async () => {
    const account = {
      status: 'ready' as const,
      authMode: 'managed-login',
      modelSource: 'token-plan' as const,
      managedTokenPresent: true,
      warnings: [],
    };

    await expect(
      requireTuiAgentAccess({ getAccountStatus: async () => account }),
    ).resolves.toBe(account);
  });

  it.each([
    { authMode: 'managed-login', modelSource: 'token-plan' as const },
    { authMode: 'managed-login', modelSource: undefined },
    { authMode: undefined, modelSource: 'token-plan' as const },
  ])('rejects an unauthenticated managed Agent Run: %s', async (selection) => {
    const account = {
      status: 'needs-login' as const,
      ...selection,
      managedTokenPresent: false,
      warnings: [],
    };

    await expect(
      requireTuiAgentAccess({ getAccountStatus: async () => account }),
    ).rejects.toMatchObject({
      name: 'TuiLoginRequiredError',
      category: 'config',
      code: 'auth.login_required',
      retryable: false,
      message: MINIMAX_CODE_HEADLESS_LOGIN_REQUIRED_MESSAGE,
      account,
    } satisfies Partial<TuiLoginRequiredError>);
  });

  it('still requires MiniMax login for account-backed services while BYOK is selected', async () => {
    const account = {
      status: 'ready' as const,
      authMode: 'byok',
      modelSource: 'byok' as const,
      managedTokenPresent: false,
      warnings: [],
    };

    await expect(
      requireTuiAccountLogin({ getAccountStatus: async () => account }),
    ).rejects.toMatchObject({
      code: 'auth.login_required',
      account,
    });
  });
});
