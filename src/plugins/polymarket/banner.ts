import chalk from 'chalk';

export function printPmOrderSubmitBanner(): void {
  console.error(chalk.green.bold('\n[POLYMARKET] Signing order via Privy, then submitting through the Byreal gateway/CLOB\n'));
}

export function printPmDepositSubmitBanner(): void {
  console.error(chalk.green.bold('\n[POLYMARKET] Signing Solana transfer via Privy, then submitting bridge order through the Byreal gateway\n'));
}

export function printPmWithdrawSubmitBanner(): void {
  console.error(chalk.green.bold('\n[POLYMARKET] Submitting withdraw through the Byreal gateway (server-side Privy signing + relayer)\n'));
}

export function printPmDeploySubmitBanner(): void {
  console.error(chalk.green.bold('\n[POLYMARKET] Submitting account deploy through the Byreal gateway (Privy signing + relayer)\n'));
}

export function printPmCancelSubmitBanner(): void {
  console.error(chalk.green.bold('\n[POLYMARKET] Submitting cancel request through the Byreal gateway/CLOB\n'));
}
