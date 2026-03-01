import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  AccountInfo,
  Commitment,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
  RpcResponseAndContext,
} from '@solana/web3.js';
import BN from 'bn.js';

import { SPLTokenAccountLayout } from '../layout.js';
import { GetStructureSchema } from '../libs/marshmallow/index.js';
import { getATAAddress } from '../pda.js';

export interface ParseTokenAccount {
  owner: PublicKey;
  solAccountResp?: AccountInfo<Buffer> | null;
  tokenAccountResp: RpcResponseAndContext<GetProgramAccountsResponse>;
}

export type ISPLTokenAccount = GetStructureSchema<typeof SPLTokenAccountLayout>;

export interface TokenAccountRaw {
  programId: PublicKey;
  pubkey: PublicKey;
  accountInfo: ISPLTokenAccount;
}

export interface TokenAccount {
  publicKey?: PublicKey;
  mint: PublicKey;
  isAssociated?: boolean;
  amount: BN;
  isNative: boolean;
  programId: PublicKey;
}

/**
 * Get all token account information in the wallet (pure function version)
 *
 * This function will simultaneously query user's SOL account, standard SPL token accounts, and Token-2022 accounts.
 *
 * @param connection - Solana connection instance
 * @param ownerPubKey - Public key of the wallet owner
 * @param commitment - Optional commitment level
 * @returns Promise containing token accounts and raw account information
 */
export async function fetchWalletTokenAccounts(
  connection: Connection,
  ownerPubKey: PublicKey,
  commitment?: Commitment
): Promise<{
  tokenAccounts: TokenAccount[];
  rawTokenAccountInfos: TokenAccountRaw[];
}> {
  // Request all account information in parallel
  const [solAccountResp, ownerTokenAccountResp, ownerToken2022AccountResp] = await Promise.all([
    connection.getAccountInfo(ownerPubKey, commitment),
    connection.getTokenAccountsByOwner(ownerPubKey, { programId: TOKEN_PROGRAM_ID }, commitment),
    connection.getTokenAccountsByOwner(
      ownerPubKey,
      { programId: TOKEN_2022_PROGRAM_ID },
      commitment
    ),
  ]);

  // Parse and merge all token account information
  const { tokenAccounts, rawTokenAccountInfos } = parseTokenAccountResp({
    owner: ownerPubKey,
    solAccountResp,
    tokenAccountResp: {
      context: ownerTokenAccountResp.context,
      value: [...ownerTokenAccountResp.value, ...ownerToken2022AccountResp.value],
    },
  });

  return { tokenAccounts, rawTokenAccountInfos };
}

export function parseTokenAccountResp({
  owner,
  solAccountResp,
  tokenAccountResp,
}: ParseTokenAccount): {
  tokenAccounts: TokenAccount[];
  rawTokenAccountInfos: TokenAccountRaw[];
} {
  const tokenAccounts: TokenAccount[] = [];
  const rawTokenAccountInfos: TokenAccountRaw[] = [];

  for (const { pubkey, account } of tokenAccountResp.value) {
    const accountInfo = SPLTokenAccountLayout.decode(account.data);
    const { mint, amount } = accountInfo;
    tokenAccounts.push({
      publicKey: pubkey,
      mint,
      amount,
      isAssociated: getATAAddress(owner, mint, account.owner).publicKey.equals(pubkey),
      isNative: false,
      programId: account.owner,
    });
    rawTokenAccountInfos.push({ pubkey, accountInfo, programId: account.owner });
  }

  if (solAccountResp) {
    tokenAccounts.push({
      mint: PublicKey.default,
      amount: new BN(String(solAccountResp.lamports)),
      isNative: true,
      programId: solAccountResp.owner,
    });
  }

  return {
    tokenAccounts,
    rawTokenAccountInfos,
  };
}
