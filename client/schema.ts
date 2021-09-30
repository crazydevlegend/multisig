import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {Schema} from 'borsh';

export class GroupMember {
  publicKey: Uint8Array;
  weight: number;

  constructor(
    publicKey_or_not: PublicKey | Record<string, any>,
    weight: number,
  ) {
    if (publicKey_or_not instanceof PublicKey) {
      this.publicKey = publicKey_or_not.toBuffer();
      this.weight = weight;
    } else {
      this.publicKey = publicKey_or_not.publicKey as Uint8Array;
      this.weight = publicKey_or_not.weight as number;
    }
  }
}

export class GroupData {
  members: GroupMember[];
  threshold: number;

  constructor(
    members_or_not: GroupMember[] | Record<string, any>,
    threshold: number,
  ) {
    if (members_or_not instanceof Array) {
      this.members = members_or_not;
      this.threshold = threshold;
    } else {
      this.members = members_or_not.members as GroupMember[];
      this.threshold = members_or_not.threshold as number;
    }
  }
}

export class ProtectedAccountConfig {
  lamports: number;
  space: number;
  owner: Uint8Array;

  constructor(lamports: number, space: number, owner: PublicKey) {
    this.lamports = lamports;
    this.space = space;
    this.owner = owner.toBuffer();
  }
}

export class InitInstruction {
  group_data: GroupData;
  lamports: number;
  protected_account_config: ProtectedAccountConfig | null;

  constructor(
    group_data: GroupData,
    lamports: number,
    protected_account_config: ProtectedAccountConfig | null,
  ) {
    this.group_data = group_data;
    this.lamports = lamports;
    this.protected_account_config = protected_account_config;
  }
}

export class ProposedAccountMeta {
  pubkey: Uint8Array;
  is_signer: boolean;
  is_writable: boolean;

  constructor(
    pubkey_or_whatever: Record<string, any> | PublicKey,
    is_signer: boolean,
    is_writable: boolean,
  ) {
    if (pubkey_or_whatever instanceof PublicKey) {
      this.pubkey = pubkey_or_whatever.toBuffer();
      this.is_signer = is_signer;
      this.is_writable = is_writable;
    } else {
      this.pubkey = pubkey_or_whatever.pubkey as Uint8Array;
      this.is_signer = pubkey_or_whatever.is_signer == 0 ? false : true;
      this.is_writable = pubkey_or_whatever.is_writable == 0 ? false : true;
    }
  }
}

export class ProposedInstruction {
  program_id: Uint8Array;
  accounts: ProposedAccountMeta[];
  data: Uint8Array;

  constructor(
    first_argument: Record<string, any> | PublicKey,
    accounts: ProposedAccountMeta[],
    data: Uint8Array,
  ) {
    if (first_argument instanceof PublicKey) {
      this.program_id = first_argument.toBuffer();
      this.accounts = accounts;
      this.data = data;
    } else {
      this.program_id = first_argument.program_id as Uint8Array;
      this.accounts = first_argument.accounts as ProposedAccountMeta[];
      this.data = first_argument.data as Uint8Array;
    }
  }
}

export class ProposeInstruction {
  instruction: ProposedInstruction;
  lamports: number;

  constructor(instruction: ProposedInstruction, lamports: number) {
    this.instruction = instruction;
    this.lamports = lamports;
  }
}

export class ProposalState {
  members: BN;
  current_weight: BN;

  constructor(rec: Record<string, any>) {
    this.members = rec.members as BN;
    this.current_weight = rec.current_weight as BN;
  }
}

export class ProposalConfig {
  group: Uint8Array;
  instruction: ProposedInstruction;

  constructor(rec: Record<string, any>) {
    this.group = rec.group as Uint8Array;
    this.instruction = rec.instruction as ProposedInstruction;
  }
}

export class ProposalData {
  config: ProposalConfig;
  state: ProposalState;

  constructor(rec: Record<string, any>) {
    this.config = rec.config as ProposalConfig;
    this.state = rec.state as ProposalState;
  }
}

export class ApproveInstruction {}

export class InstructionData {
  init?: InitInstruction;
  propose?: ProposeInstruction;
  approve?: ApproveInstruction;
  variant: string;

  constructor(instr: GroupData | ProposeInstruction | ApproveInstruction) {
    this.variant = '';

    if (instr instanceof InitInstruction) {
      this.init = instr;
      this.variant = 'init';
    } else if (instr instanceof ProposeInstruction) {
      this.propose = instr;
      this.variant = 'propose';
    } else if (instr instanceof ApproveInstruction) {
      this.approve = instr;
      this.variant = 'approve';
    } else {
      throw 'unknown type';
    }
  }
}

// https://github.com/near/borsh-js/issues/5
function intToBool(i: number) {
  return i !== 0;
}

function boolToInt(t: boolean) {
  return t ? 1 : 0;
}

const boolMapper = {
  encode: boolToInt,
  decode: intToBool,
};

export const schema: Schema = new Map([
  <any>[
    GroupData,
    {
      kind: 'struct',
      fields: [
        ['members', [GroupMember]],
        ['threshold', 'u32'],
      ],
    },
  ],
  [
    GroupMember,
    {
      kind: 'struct',
      fields: [
        ['publicKey', [32]],
        ['weight', 'u32'],
      ],
    },
  ],
  [
    ApproveInstruction,
    {
      kind: 'struct',
      fields: [],
    },
  ],
  [
    ProposedAccountMeta,
    {
      kind: 'struct',
      fields: [
        ['pubkey', [32]],
        ['is_signer', 'u8', boolMapper],
        ['is_writable', 'u8', boolMapper],
      ],
    },
  ],
  [
    ProposedInstruction,
    {
      kind: 'struct',
      fields: [
        ['program_id', [32]],
        ['accounts', [ProposedAccountMeta]],
        ['data', ['u8']],
      ],
    },
  ],
  [
    ProposalState,
    {
      kind: 'struct',
      fields: [
        ['members', 'u64'],
        ['current_weight', 'u32'],
      ],
    },
  ],
  [
    ProposalConfig,
    {
      kind: 'struct',
      fields: [
        ['group', [32]],
        ['instruction', ProposedInstruction],
      ],
    },
  ],
  [
    ProposalData,
    {
      kind: 'struct',
      fields: [
        ['config', ProposalConfig],
        ['state', ProposalState],
      ],
    },
  ],
  [
    ProtectedAccountConfig,
    {
      kind: 'struct',
      fields: [
        ['lamports', 'u64'],
        ['space', 'u64'],
        ['owner', [32]],
      ],
    },
  ],

  [
    InitInstruction,
    {
      kind: 'struct',
      fields: [
        ['group_data', GroupData],
        ['lamports', 'u64'],
        [
          'protected_account_config',
          {
            kind: 'option',
            type: ProtectedAccountConfig,
          },
        ],
      ],
    },
  ],
  [
    ProposeInstruction,
    {
      kind: 'struct',
      fields: [
        ['instruction', ProposedInstruction],
        ['lamports', 'u64'],
      ],
    },
  ],
  [
    InstructionData,
    {
      kind: 'enum',
      field: 'variant',
      values: [
        ['init', InitInstruction],
        ['propose', ProposeInstruction],
        ['approve', ApproveInstruction],
      ],
    },
  ],
]);
