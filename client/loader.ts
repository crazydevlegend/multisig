import {Buffer} from 'buffer';
import * as BufferLayout from '@solana/buffer-layout';

import {
  PublicKey,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
  Connection,
  Signer,
  SystemProgram,
  Account,
  TransactionInstruction,
} from '@solana/web3.js';

export const UPGRADEABLE_BPF_LOADER_PROGRAM_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

// Keep program chunks under PACKET_DATA_SIZE, leaving enough room for the
// rest of the Transaction fields
const CHUNK_SIZE = 900;

function encodeInstruction(data: any): Buffer {
  const dataLayout = BufferLayout.union(BufferLayout.u32('tag'), null, 'tag');
  dataLayout.addVariant(0, BufferLayout.struct([]), 'InitializeBuffer');
  const write = BufferLayout.struct([
    BufferLayout.u32('offset'),
    BufferLayout.nu64('length'),
    BufferLayout.seq(
      BufferLayout.u8('byte'),
      BufferLayout.offset(BufferLayout.u32(), -8),
      'bytes',
    ),
  ]);
  dataLayout.addVariant(1, write, 'Write');
  const deployWithMaxLen = BufferLayout.struct([
    BufferLayout.nu64('max_data_len'),
  ]);
  dataLayout.addVariant(2, deployWithMaxLen, 'DeployWithMaxDataLen');
  dataLayout.addVariant(3, BufferLayout.struct([]), 'Upgrade');
  dataLayout.addVariant(4, BufferLayout.struct([]), 'SetAuthority');
  dataLayout.addVariant(5, BufferLayout.struct([]), 'Close');

  // UpgradeableLoaderInstruction tag + offset + chunk length + chunk data
  const instructionBuffer = Buffer.alloc(4 + 4 + 8 + Loader.chunkSize);
  const encodedSize = dataLayout.encode(data, instructionBuffer);
  return instructionBuffer.slice(0, encodedSize);
}

/**
 * Program loader interface
 */
export class Loader {
  /**
   * Amount of program data placed in each load Transaction
   */
  static chunkSize: number = CHUNK_SIZE;

  /**
   * Minimum number of signatures required to load a program not including
   * retries
   *
   * Can be used to calculate transaction fees
   */
  static getMinNumSignatures(dataLength: number): number {
    return (
      2 * // Every transaction requires two signatures (payer + program)
      (Math.ceil(dataLength / Loader.chunkSize) +
        1 + // Add one for Create transaction
        1) // Add one for Finalize transaction
    );
  }

  static async deploy(
    connection: Connection,
    payer: Signer,
    program: Signer,
    authority: Signer,
    data: Buffer | Uint8Array | Array<number>,
  ): Promise<boolean> {
    const buffer = new Account();
    console.log('buffer account', buffer.publicKey.toBase58());
    console.log('authority account', authority.publicKey.toBase58());
    // UpgradeableLoaderState::buffer_len(program_len) = 37 + program_len
    const bufferSpace = 37 + data.length;
    const balanceNeeded = await connection.getMinimumBalanceForRentExemption(
      bufferSpace,
    );

    const initTransaction = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: buffer.publicKey,
          lamports: balanceNeeded,
          space: bufferSpace,
          programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
        }),
      )
      .add(
        new TransactionInstruction({
          keys: [
            {pubkey: buffer.publicKey, isSigner: false, isWritable: true},
            {pubkey: authority.publicKey, isSigner: false, isWritable: false},
          ],
          programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
          data: encodeInstruction({InitializeBuffer: {}}),
        }),
      );
    await sendAndConfirmTransaction(
      connection,
      initTransaction,
      [payer, buffer],
      {
        commitment: 'confirmed',
      },
    );
    console.log('program buffer initialized');

    const chunkSize = Loader.chunkSize;
    let offset = 0;
    let array = data;
    while (array.length > 0) {
      const bytes = array.slice(0, Loader.chunkSize);
      const transaction = new Transaction().add({
        keys: [
          {pubkey: buffer.publicKey, isSigner: false, isWritable: true},
          {pubkey: authority.publicKey, isSigner: true, isWritable: false},
        ],
        programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
        data: encodeInstruction({
          Write: {
            offset,
            bytes,
          },
        }),
      });
      await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer, authority],
        {
          commitment: 'confirmed',
        },
      );
      console.log('write progress:', offset, '/', data.length);

      offset += chunkSize;
      array = array.slice(chunkSize);
    }
    console.log('buffer write complete');

    const programSpace = 36; // UpgradeableLoaderState::program_len()
    const programBalanceNeeded = await connection.getMinimumBalanceForRentExemption(
      programSpace,
    );
    const [programDataKey, _nonce] = await PublicKey.findProgramAddress(
      [program.publicKey.toBuffer()],
      UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
    );

    const deployTransaction = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: program.publicKey,
          lamports: programBalanceNeeded,
          space: programSpace,
          programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
        }),
      )
      .add(
        new TransactionInstruction({
          keys: [
            {pubkey: payer.publicKey, isSigner: true, isWritable: true},
            {pubkey: programDataKey, isSigner: false, isWritable: true},
            {pubkey: program.publicKey, isSigner: false, isWritable: true},
            {pubkey: buffer.publicKey, isSigner: false, isWritable: true},

            {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
            {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
            {pubkey: authority.publicKey, isSigner: true, isWritable: false},
          ],
          programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
          data: encodeInstruction({
            DeployWithMaxDataLen: {max_data_len: data.length},
          }),
        }),
      );

    await sendAndConfirmTransaction(
      connection,
      deployTransaction,
      [payer, program, authority],
      {
        commitment: 'confirmed',
      },
    );

    return true;
  }

  static async upgradeInstruction(
    program: PublicKey,
    buffer: PublicKey,
    spillAddress: PublicKey,
    authority: PublicKey,
  ): Promise<TransactionInstruction> {
    const [programDataKey, _nonce] = await PublicKey.findProgramAddress(
      [program.toBuffer()],
      UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
    );

    return new TransactionInstruction({
      keys: [
        {pubkey: programDataKey, isSigner: false, isWritable: true},
        {pubkey: program, isSigner: false, isWritable: true},
        {pubkey: buffer, isSigner: false, isWritable: true},
        {pubkey: spillAddress, isSigner: false, isWritable: true},
        {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
        {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
        {pubkey: authority, isSigner: true, isWritable: false},
      ],
      programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
      data: encodeInstruction({Upgrade: {}}),
    });
  }

  static async setUpgradeAuthorityInstruction(
    program: PublicKey,
    currentAuthority: PublicKey,
    newAuthority: PublicKey,
  ): Promise<TransactionInstruction> {
    const [programDataKey, _nonce] = await PublicKey.findProgramAddress(
      [program.toBuffer()],
      UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
    );
    return new TransactionInstruction({
      keys: [
        {pubkey: programDataKey, isSigner: false, isWritable: true},
        {pubkey: currentAuthority, isSigner: true, isWritable: false},
        {pubkey: newAuthority, isSigner: false, isWritable: false},
      ],
      programId: UPGRADEABLE_BPF_LOADER_PROGRAM_ID,
      data: encodeInstruction({SetAuthority: {}}),
    });
  }
}
