import {
  Account,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
const splToken = require('@solana/spl-token');
import { createTokenAccount, } from './tokens';
import {
  ProposedAccountMeta,
  ProposeInstruction,
  ProposedInstruction,
  ProposalConfig,
} from './schema';

import { MultiSig } from './multisig';

import { Loader } from './loader';


export enum PropositionKind {
  Create,
  Transfer,
  Upgrade,
  UpgradeMultisig,
  DelegateUpgradeAuthority,
  DelegateMintAuthority,
  DelegateTokenAuthority,
  MintTo,
  CreateTokenAccount,
  TransferToken
}

export type PropositionType = Create | Transfer | Upgrade | UpgradeMultisig | DelegateUpgradeAuthority
  | DelegateMintAuthority | DelegateTokenAuthority | MintTo | CreateTokenAccount | TransferToken;

export interface Create {
  kind: PropositionKind.Create,
  lamports: number
}

export interface Transfer {
  kind: PropositionKind.Transfer,
  destination: PublicKey,
  amount: number
}

export interface Upgrade {
  kind: PropositionKind.Upgrade,
  buffer: PublicKey,
  program: PublicKey
}

export interface UpgradeMultisig {
  kind: PropositionKind.UpgradeMultisig,
  buffer: PublicKey,
}

export interface DelegateUpgradeAuthority {
  kind: PropositionKind.DelegateUpgradeAuthority,
  target: PublicKey,
  newAuthority: PublicKey,
}

export interface DelegateMintAuthority {
  kind: PropositionKind.DelegateMintAuthority,
  target: PublicKey,
  newAuthority: PublicKey,
}

export interface DelegateTokenAuthority {
  kind: PropositionKind.DelegateTokenAuthority,
  target: PublicKey,
  newAuthority: PublicKey,
}


export interface MintTo {
  kind: PropositionKind.MintTo,
  mint: PublicKey,
  destination: PublicKey,
  amount: number
}

export interface CreateTokenAccount {
  kind: PropositionKind.CreateTokenAccount,
  mint: PublicKey,
  seed: string,
}

export interface TransferToken {
  kind: PropositionKind.TransferToken,
  source: PublicKey,
  destination: PublicKey,
  amount: number
}

export async function createProposal(connection: Connection, multisig: MultiSig,
  groupAccount: PublicKey,
  protectedGroupAccount: PublicKey,
  signerAccount: Account,
  proposition: PropositionType): Promise<PublicKey[]> {
  let proposedInstructions: TransactionInstruction[];
  switch (proposition.kind) {
    case PropositionKind.Create:
      proposedInstructions = [SystemProgram.createAccount({
        fromPubkey: signerAccount.publicKey,
        newAccountPubkey: protectedGroupAccount,
        lamports: proposition.lamports,
        space: 0,
        programId: SystemProgram.programId,
      })
      ];
      break;
    case PropositionKind.Transfer:
      proposedInstructions = [SystemProgram.transfer({
        fromPubkey: protectedGroupAccount,
        toPubkey: proposition.destination,
        lamports: proposition.amount,
      })];
      break;
    case PropositionKind.Upgrade:
      proposedInstructions = [await Loader.upgradeInstruction(
        proposition.program,
        proposition.buffer,
        protectedGroupAccount,
        protectedGroupAccount,
      )];
      break;
    case PropositionKind.UpgradeMultisig:
      proposedInstructions = [await Loader.upgradeInstruction(
        multisig.programId,
        proposition.buffer,
        protectedGroupAccount,
        protectedGroupAccount,
      )];
      break;
    case PropositionKind.DelegateUpgradeAuthority:
      proposedInstructions = [await Loader.setUpgradeAuthorityInstruction(
        proposition.target,
        protectedGroupAccount,
        proposition.newAuthority
      )]
      break;
    case PropositionKind.DelegateTokenAuthority:
      proposedInstructions = [await splToken.Token.createSetAuthorityInstruction(
        splToken.TOKEN_PROGRAM_ID,
        proposition.target,
        proposition.newAuthority,
        'AccountOwner',
        protectedGroupAccount,
        [],
      )]
      break;
    case PropositionKind.DelegateMintAuthority:
      proposedInstructions = [await splToken.Token.createSetAuthorityInstruction(
        splToken.TOKEN_PROGRAM_ID,
        proposition.target,
        proposition.newAuthority,
        'MintTokens',
        protectedGroupAccount,
        [],
      )]
      break;
    case PropositionKind.MintTo:
      proposedInstructions = [await splToken.Token.createMintToInstruction(
        splToken.TOKEN_PROGRAM_ID,
        proposition.mint,
        proposition.destination,
        // Authority is implied to be group's protected account
        protectedGroupAccount,
        [],
        proposition.amount
      )];
      break;
    case PropositionKind.CreateTokenAccount:
      proposedInstructions = await createTokenAccount(connection, protectedGroupAccount,
        proposition.mint, proposition.seed
      );
      break;
    case PropositionKind.TransferToken:
      proposedInstructions = [
        splToken.Token.createTransferInstruction(
          splToken.TOKEN_PROGRAM_ID,
          proposition.source,
          proposition.destination,
          // Authority is implied to be group's protected account
          protectedGroupAccount,
          [],
          proposition.amount,
        )];
      break;
    default:
      throw ("unsupported proposition");
  }
  return await proposeMulti(connection, multisig, signerAccount, groupAccount, proposedInstructions)
}

export async function createApprove(connection: Connection, multisig: MultiSig,
  signer: Account,
  proposal: PublicKey,
): Promise<void> {
  console.log('signing with account', signer.publicKey.toBase58());

  const proposalAccountInfo = await connection.getAccountInfo(proposal);
  if (proposalAccountInfo === null) {
    throw 'error: cannot find the proposal account';
  }

  const proposalData = multisig.readProposalAccountData(proposalAccountInfo);

  const groupAccount = new PublicKey(proposalData.config.group);
  console.log('group account:', groupAccount.toBase58());
  const protectedAccount = await multisig.protectedAccountKey(groupAccount);
  console.log('protected account:', protectedAccount.toBase58());

  const transaction = new Transaction().add(
    await multisig.approve(
      proposal,
      proposalData.config,
      signer.publicKey,
    ),
  );

  await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'singleGossip',
    preflightCommitment: 'singleGossip',
  });
}

// Use for proposal 'createTokenAccount'
export async function createMultiApprove(connection: Connection, multisig: MultiSig,
  signer: Account,
  proposals: PublicKey[],
): Promise<void> {
  console.log('signing with account', signer.publicKey.toBase58());

  let transaction = new Transaction();
  for (const proposalAccount of proposals) {

    const proposalAccountInfo = await connection.getAccountInfo(proposalAccount);
    if (proposalAccountInfo === null) {
      throw 'error: cannot find the proposal account';
    }

    const proposalData = multisig.readProposalAccountData(proposalAccountInfo);

    const groupAccount = new PublicKey(proposalData.config.group);
    console.log('group account:', groupAccount.toBase58());
    const protectedAccount = await multisig.protectedAccountKey(groupAccount);
    console.log('protected account:', protectedAccount.toBase58());

    transaction.add(
      await multisig.approve(
        proposalAccount,
        proposalData.config,
        signer.publicKey,
      ),
    );
  }

  await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'singleGossip',
    preflightCommitment: 'singleGossip',
  });
}

export async function proposeMulti(
  connection: Connection,
  multisig: MultiSig,
  signerAccount: Account,
  groupAccount: PublicKey,
  instructions: TransactionInstruction[]
): Promise<PublicKey[]> {
  let transaction = new Transaction();
  const proposalKeys = [];
  for (const instruction of instructions) {
    const proposedInstructionData = new ProposedInstruction(
      instruction.programId,
      instruction.keys.map(
        key => new ProposedAccountMeta(key.pubkey, key.isSigner, key.isWritable),
      ),
      instruction.data,
    );

    const proposalConfig = new ProposalConfig({
      group: Uint8Array.from(groupAccount.toBuffer()),
      instruction: proposedInstructionData,
    });
    const proposalKey = await multisig.proposalAccountKey(proposalConfig);
    proposalKeys.push(proposalKey);

    const rent = await connection.getMinimumBalanceForRentExemption(
      multisig.proposalAccountSpace(proposalConfig),
    );

    const proposeInstruction = new ProposeInstruction(
      proposedInstructionData,
      rent,
    );

    transaction.add(
      await multisig.propose(
        proposeInstruction,
        groupAccount,
        signerAccount.publicKey,
      ),
    );
  }
  await sendAndConfirmTransaction(connection, transaction, [signerAccount], {
    commitment: 'singleGossip',
    preflightCommitment: 'singleGossip',
  });
  console.log('created proposal accounts:');
  for (const proposalKey of proposalKeys) {
    console.log('\tkey:', proposalKey.toBase58());
  }
  return proposalKeys
}