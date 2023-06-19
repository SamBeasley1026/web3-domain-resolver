import { ethers } from "ethers";
import { NetworkConnection, NetworkName } from "./network-connection.types";
import { ConnectionInfo } from "./contract-connection.types";
import { Contract, ContractFactory } from "./contract";
import { Connection } from "@solana/web3.js";

/**
 * This class represents a connection to a smart contract.
 */
export class ContractConnection {

	/**
	 * Connection info
	 */
	protected _connection: NetworkConnection | Connection;
	/**
	 * Smart contract address
	 */
	protected _address: string;
	/**
	 * Smart contract provider
	 */
	protected _provider!: ethers.providers.Provider;
	/**
	 * Smart contract instance
	 */
	protected _contract!: Contract;
	/**
	 * Smart contract abi
	 */
	// protected _abi?: ethers.ContractInterface;

	public constructor(arg: ConnectionInfo) {
		const { network, address } = arg || {};
		this._connection = network;
		this._address = address;
		if (!(network instanceof Connection)) {
			this._provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
		}
		this._contract = ContractFactory.createContract(arg);
	}

	public get connection(): NetworkConnection {
		if (this._connection instanceof Connection) return { networkName: "solana", rpcUrl: "" };
		return this._connection;
	}

	public get address(): string {
		return this._address;
	}

	public get provider(): ethers.providers.Provider {
		return this._provider;
	}

	public get contract(): Contract {
		return this._contract;
	}

	public get network(): NetworkName | string {
		if (this._connection instanceof Connection) return "solana";
		return this._connection.networkName;
	}


}