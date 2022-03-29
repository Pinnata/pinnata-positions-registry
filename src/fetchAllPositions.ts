import { getAddress } from "@ethersproject/address";
import { AddressZero } from "@ethersproject/constants";
import type { ContractInterface } from "@ethersproject/contracts";
import { Contract } from "@ethersproject/contracts";
import type { JsonRpcProvider } from "@ethersproject/providers";
import { StaticJsonRpcProvider } from "@ethersproject/providers";
import * as fs from "fs/promises";
import { chunk } from "lodash";
import invariant from "tiny-invariant";

import HOMORA_BANK_ABI from "./abis/HomoraBank.json";
import MULTICALL_ABI from "./abis/multicall2.json";
import type { HomoraBank, Multicall2 } from "./generated";

const MAX_CHUNK = 100;
export interface Call {
  target: string;
  callData: string;
}

// returns the checksummed address if the address is valid, otherwise returns false
export function isAddress(value: string): string | false {
  try {
    return getAddress(value);
  } catch {
    return false;
  }
}

// account is optional
export function getContract(
  address: string,
  ABI: ContractInterface,
  provider: JsonRpcProvider
): Contract {
  if (!isAddress(address) || address === AddressZero) {
    throw Error(`Invalid 'address' parameter '${address}'.`);
  }
  return new Contract(address, ABI, provider);
}

function useContract(
  address: string | undefined,
  ABI: ContractInterface,
  provider: JsonRpcProvider
): Contract | null {
  if (!address || !ABI) return null;
  try {
    return getContract(address, ABI, provider);
  } catch (error) {
    console.error("Failed to get contract", error);
    return null;
  }
}

function useBankContract(provider: JsonRpcProvider): HomoraBank | null {
  return useContract(
    "0x827cCeA3D460D458393EEAfE831698d83FE47BA7",
    HOMORA_BANK_ABI.abi,
    provider
  ) as HomoraBank | null;
}

export function useMulticall(provider: JsonRpcProvider): Multicall2 | null {
  return useContract(
    "0x9aac9048fC8139667D6a2597B902865bfdc225d3",
    MULTICALL_ABI,
    provider
  ) as Multicall2 | null;
}

export interface Positions {
  nextPositionID: number;
  ownerMap: {
    positionID: number;
    owner: string;
  }[];
}

export const fetchAllPositons = async (): Promise<void> => {
  const provider = new StaticJsonRpcProvider("https://forno.celo.org");

  const bankContract = useBankContract(provider);
  const multicall = useMulticall(provider);

  invariant(bankContract);
  invariant(multicall);

  const nextPositionID = await bankContract?.nextPositionId();

  const getMulticallDataChunked = async (calls: Call[]) => {
    const callChunks = chunk(calls, MAX_CHUNK);
    return (
      await Promise.all(
        callChunks.map((c) => multicall?.callStatic.aggregate(c))
      )
    ).flatMap((c) => c?.returnData);
  };

  const calls = [...Array(nextPositionID?.toNumber() ?? 0).keys()].map((n) => ({
    target: bankContract?.address,
    callData: bankContract?.interface.encodeFunctionData("getPositionInfo", [
      n + 1,
    ]),
  }));

  const ownerMap = (await getMulticallDataChunked(calls)).map(
    (returnData, i) => {
      const decoded = bankContract.interface.decodeFunctionResult(
        "getPositionInfo",
        returnData
      );
      return {
        positionID: i + 1,
        owner: decoded["owner"] as string,
      };
    }
  );

  const positions: Positions = {
    nextPositionID: nextPositionID?.toNumber() ?? 1,
    ownerMap: ownerMap,
  };

  await fs.writeFile("data/positions.json", JSON.stringify(positions, null, 2));

  console.log(`Discovered and wrote ${ownerMap.length} positions`);
};

fetchAllPositons().catch((err) => {
  console.error(err);
});
