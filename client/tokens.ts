import {
    Connection,
    PublicKey,
    SystemProgram,
    TransactionInstruction
} from '@solana/web3.js';
const splToken = require('@solana/spl-token');

export async function createTokenAccount(
    connection: Connection,
    protectedGroupKey: PublicKey,
    mint: PublicKey,
    seed: string
    ): Promise<TransactionInstruction[]> {
    const balanceNeeded = await splToken.Token.getMinBalanceRentForExemptAccount(
        connection,
    );
    const resultingTokenAddress = await PublicKey.createWithSeed(protectedGroupKey, seed, splToken.TOKEN_PROGRAM_ID);
    console.log("creating token account: ", resultingTokenAddress.toString());
    const creationPropose = SystemProgram.createAccountWithSeed({
        basePubkey: protectedGroupKey,
        // Pays for creation
        // TODO: does it have money?
        fromPubkey: protectedGroupKey,
        newAccountPubkey: resultingTokenAddress,
        lamports: balanceNeeded,
        programId: splToken.TOKEN_PROGRAM_ID,
        seed: seed,
        space: splToken.AccountLayout.span
    });
    const initPropose = splToken.Token.createInitAccountInstruction(
        splToken.TOKEN_PROGRAM_ID,
        mint,
        resultingTokenAddress,
        protectedGroupKey
    );

    return [creationPropose, initPropose];
}