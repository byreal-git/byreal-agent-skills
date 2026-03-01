import path from 'path';

import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { SignerCallback } from '../client/models.js';
import { Chain } from '../client/index.js';
import { BYREAL_CLMM_PROGRAM_ID } from '../constants.js';

const endpoint = process.env.SOLANA_RPC_ENDPOINT || clusterApiUrl('mainnet-beta');
const secretKey = process.env.WALLET_SECRET_KEY;

if (!secretKey) {
  throw new Error('Please set your WALLET_SECRET_KEY in .env');
}

export const connection = new Connection(endpoint);

export const userKeypair = Keypair.fromSecretKey(bs58.decode(secretKey));

export const userAddress = userKeypair.publicKey;

export const chain = new Chain({ connection, programId: BYREAL_CLMM_PROGRAM_ID });

export const signerCallback: SignerCallback = async (tx) => {
  tx.sign([userKeypair]);
  return tx;
};

export const TokenAddress = {
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  BBSOL: new PublicKey('Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B'),
};

export const PoolAddress = {
  SOL_BBSOL: new PublicKey('87pbGHxigtjdMovzkAAFEe8XFVTETjDomoEFfpSFd2yD'),
  USDC_USDT: new PublicKey('23XoPQqGw9WMsLoqTu8HMzJLD6RnXsufbKyWPLJywsCT'),
  SOL_USDC: new PublicKey('9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq'),
};
