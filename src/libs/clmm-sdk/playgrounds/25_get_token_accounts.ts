import { fetchWalletTokenAccounts } from '../instructions/utils/fetchWalletTokenAccounts';
import { connection, userAddress } from './config';

fetchWalletTokenAccounts(connection, userAddress).then((result) => {
  result.tokenAccounts.forEach((tokenAccount) => {
    console.log('--------------------------------');
    console.log('mint: ', tokenAccount.mint.toBase58());
    console.log('amount: ', tokenAccount.amount.toString());
    console.log('isNative: ', tokenAccount.isNative);
    console.log('programId: ', tokenAccount.programId.toBase58());
    console.log('isAssociated: ', tokenAccount.isAssociated);
    console.log('publicKey: ', tokenAccount.publicKey?.toBase58());
    console.log('--------------------------------');
  });
});
