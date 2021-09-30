import {
  schema,
  GroupData,
  ProposedAccountMeta,
  ProposeInstruction,
  ProposalConfig,
  ProposalState,
  ProposalData,
  ApproveInstruction,
  InitInstruction,
  InstructionData,
} from './schema';
import {
  AccountInfo,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {serialize, deserialize} from 'borsh';
import CryptoJS from 'crypto-js';

export class MultiSig {
  programId: PublicKey;

  constructor(programId: PublicKey) {
    this.programId = programId;
  }

  async groupAccountKey(groupData: GroupData): Promise<PublicKey> {
    const serializedGroup = serialize(schema, groupData);
    const hash_str = CryptoJS.SHA256(
      byteArrayToWordArray(serializedGroup),
    ).toString();
    const hash = Buffer.from(hash_str, 'hex');
    const [groupKey, _nonce] = await PublicKey.findProgramAddress(
      [PDA_TAG.group, hash],
      this.programId,
    );
    return groupKey;
  }

  async protectedAccountKey(groupAccountKey: PublicKey): Promise<PublicKey> {
    const [protectedAccount, _nonce] = await PublicKey.findProgramAddress(
      [PDA_TAG.protected, groupAccountKey.toBuffer()],
      this.programId,
    );
    return protectedAccount;
  }

  async proposalAccountKey(proposalConfig: ProposalConfig): Promise<PublicKey> {
    const serializedProposedConfig = serialize(schema, proposalConfig);
    const hash_str = CryptoJS.SHA256(
      byteArrayToWordArray(serializedProposedConfig),
    ).toString();
    const hash = Buffer.from(hash_str, 'hex');
    const [proposalKey, _nonce2] = await PublicKey.findProgramAddress(
      [PDA_TAG.proposal, hash],
      this.programId,
    );
    return proposalKey;
  }

  groupAccountSpace(groupData: GroupData): number {
    const serializedGroup = serialize(schema, groupData);
    return serializedGroup.length + 1;
  }

  proposalAccountSpace(config: ProposalConfig): number {
    const mockState = new ProposalState({members: 1, current_weight: 1});
    return (
      serialize(
        schema,
        new ProposalData({
          state: mockState,
          config,
        }),
      ).length +
      4 /* length */ +
      1 /* tag */
    );
  }

  readGroupAccountData(info: AccountInfo<Buffer>): GroupData {
    if (!info.owner.equals(this.programId)) {
      throw 'error: invalid account owner';
    }

    checkAccountType(info.data, ACCOUNT_TYPE_TAG.group);
    return deserialize(schema, GroupData, info.data.slice(1)) as GroupData;
  }

  readProposalAccountData(info: AccountInfo<Buffer>): ProposalData {
    if (!info.owner.equals(this.programId)) {
      throw 'error: invalid account owner';
    }

    if (!anyNonZero(info.data)) {
      throw 'data is zero (proposal may be complete)';
    }

    checkAccountType(info.data, ACCOUNT_TYPE_TAG.proposal);
    return deserialize(
      schema,
      ProposalData,
      info.data.slice(1),
    ) as ProposalData;
  }

  async init(
    data: InitInstruction,
    payerAccountKey: PublicKey,
  ): Promise<TransactionInstruction> {
    const instructionData = new InstructionData(data);
    const instructionBuffer = serialize(schema, instructionData);
    const groupAccountKey = await this.groupAccountKey(data.group_data);
    const protectedAccountKey = await this.protectedAccountKey(groupAccountKey);

    return new TransactionInstruction({
      keys: [
        {pubkey: payerAccountKey, isSigner: true, isWritable: true},
        {pubkey: groupAccountKey, isSigner: false, isWritable: true},
        {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        {pubkey: protectedAccountKey, isSigner: false, isWritable: true},
      ],
      programId: this.programId,
      data: Buffer.from(instructionBuffer),
    });
  }

  async propose(
    data: ProposeInstruction,
    groupAccountKey: PublicKey,
    signerAccountKey: PublicKey,
  ): Promise<TransactionInstruction> {
    const proposalConfig = new ProposalConfig({
      group: Uint8Array.from(groupAccountKey.toBuffer()),
      instruction: data.instruction,
    });
    const proposalKey = await this.proposalAccountKey(proposalConfig);
    const protectedAccountKey = await this.protectedAccountKey(groupAccountKey);

    const instructionData = new InstructionData(data);
    const buffer = serialize(schema, instructionData);

    return new TransactionInstruction({
      keys: [
        {pubkey: signerAccountKey, isSigner: true, isWritable: true},
        {pubkey: groupAccountKey, isSigner: false, isWritable: true},
        {pubkey: proposalKey, isSigner: false, isWritable: true},
        {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        {
          pubkey: new PublicKey(data.instruction.program_id),
          isSigner: false,
          isWritable: false,
        },
        ...data.instruction.accounts.map((account: ProposedAccountMeta) => ({
          pubkey: new PublicKey(account.pubkey),
          isSigner: protectedAccountKey.equals(new PublicKey(account.pubkey))
            ? false
            : account.is_signer,
          isWritable: account.is_writable,
        })),
      ],
      programId: this.programId,
      data: Buffer.from(buffer),
    });
  }

  async approve(
    proposalAccountKey: PublicKey,
    proposalConfig: ProposalConfig,
    signerAccountKey: PublicKey,
  ): Promise<TransactionInstruction> {
    const groupAccountKey = new PublicKey(proposalConfig.group);
    const protectedAccountKey = await this.protectedAccountKey(groupAccountKey);

    const instructionData = new InstructionData(new ApproveInstruction());
    const buffer = serialize(schema, instructionData);

    return new TransactionInstruction({
      keys: [
        {pubkey: signerAccountKey, isSigner: true, isWritable: true},
        {pubkey: groupAccountKey, isSigner: false, isWritable: true},
        {pubkey: proposalAccountKey, isSigner: false, isWritable: true},
        {
          pubkey: new PublicKey(proposalConfig.instruction.program_id),
          isSigner: false,
          isWritable: false,
        },
        ...proposalConfig.instruction.accounts.map(
          (account: ProposedAccountMeta) => ({
            pubkey: new PublicKey(account.pubkey),
            isSigner: protectedAccountKey.equals(new PublicKey(account.pubkey))
              ? false
              : account.is_signer,
            isWritable: account.is_writable,
          }),
        ),
      ],
      programId: this.programId,
      data: Buffer.from(buffer),
    });
  }
}

function byteArrayToWordArray(ba: Uint8Array): CryptoJS.lib.WordArray {
  const wa: number[] = [];
  for (let i = 0; i < ba.length; i++) {
    wa[(i / 4) | 0] |= ba[i] << (24 - 8 * i);
  }

  return CryptoJS.lib.WordArray.create(wa, ba.length);
}

const PDA_TAG = {
  group: Buffer.from([0]),
  proposal: Buffer.from([1]),
  protected: Buffer.from([2]),
};

const ACCOUNT_TYPE_TAG = {
  group: 0,
  proposal: 1,
};

function checkAccountType(data: Buffer, expected: number) {
  if (data.length == 0) {
    throw 'account data is empty';
  }
  if (data[0] != expected) {
    throw 'invalid account type';
  }
}

function anyNonZero(buffer: Buffer): boolean {
  for (const [_index, byte] of buffer.entries()) {
    if (byte != 0) {
      return true;
    }
  }
  return false;
}