import { ethers } from "ethers";
import { ConnectionLibrary } from "../../networks/connections/connection-library";
import { ContractConnection } from "../../networks/connections/contract-connection";
import { ResolvedResource } from "../../resolvers/resolved-resource/resolved-resource";
import { IResolvedResource } from "../../shared/interfaces/resolved-resource.interface";
import { ApiCaller } from "../../shared/tools/api-caller";
import { NameTools } from "../../shared/tools/name-tools";
import { MappedName } from "../../shared/types/name-tools.types";
import { IResolverProvider } from "../../shared/interfaces/resolver-provider.interface";
import { Wallet } from "@project-serum/anchor";
import { NetworkName, ProviderName, ResolvedResourceType } from "../../shared/enumerations/enumerations";
export abstract class BaseResolverProvider implements IResolverProvider {
	constructor(
		name: ProviderName,
		supportedTlds: string[],
		readContractConnections: ContractConnection[],
		writeContractConnections: ContractConnection[]) {
		this._name = name;
		this._supportedTlds = supportedTlds;
		this._readContractConnections = readContractConnections;
		this._writeContractConnections = writeContractConnections;
	}

	public get supportedNetworks(): (NetworkName)[] {
		return this._readContractConnections.map(x => x.network);
	}

	private _writeContractConnections: ContractConnection[];
	public get writeContractConnections(): ContractConnection[] {
		return this._writeContractConnections;
	}
	public set writeContractConnections(value: ContractConnection[]) {
		this._writeContractConnections = value;
	}

	private _readContractConnections: ContractConnection[];
	protected get readContractConnections(): ContractConnection[] {
		return this._readContractConnections;
	}
	protected set readContractConnections(value: ContractConnection[]) {
		this._readContractConnections = value;
	}

	protected _connectionLibrary?: ConnectionLibrary | undefined;
	public get connectionLibrary(): ConnectionLibrary | undefined {
		return this._connectionLibrary;
	}
	public set connectionLibrary(value: ConnectionLibrary | undefined) {
		this._connectionLibrary = value;
	}

	protected _name: ProviderName;
	public get name(): ProviderName {
		return this._name;
	}
	public set name(value: ProviderName) {
		this._name = value;
	}

	protected _supportedTlds: string[];
	public get supportedTlds(): string[] {
		return this._supportedTlds;
	}
	public set supportedTlds(value: string[]) {
		this._supportedTlds = value;
	}

	protected getReadContractConnection(networkName: NetworkName | string): ContractConnection | undefined {
		return this.readContractConnections.find(x => x.network == networkName);
	}

	protected getWriteContractConnection(networkName: NetworkName | string): ContractConnection | undefined {
		return this.writeContractConnections.find(x => x.network == networkName);
	}

	protected getWriteContractWithSigner(networkName: NetworkName | string, signer: Wallet | ethers.Signer) {
		const writeContractConnection = this.getWriteContractConnection(networkName);
		if (!writeContractConnection) {
			return undefined;
		}
		let signerToUse = signer;
		if (networkName != NetworkName.SOLANA && networkName != NetworkName.SOLANA_DEVNET) {
			if (!(signer as ethers.Signer)?.provider) {
				signerToUse = (signer as ethers.Signer)?.connect(writeContractConnection.provider);
			}
		}
		const contractConnected = writeContractConnection.contract.connect(signerToUse);
		return contractConnected;
	}

	public async resolve(domainOrTld: string): Promise<IResolvedResource | undefined> {
		try {
			const mappedName = NameTools.mapName(domainOrTld);
			if (!mappedName) {
				return undefined;
			}

			const network = await this.getNetworkFromName(mappedName);

			return this.generateResolvedResource(mappedName, domainOrTld, network);
		}
		catch (e) {
			return undefined;
		}
	}

	public async resolveFromTokenId(tokenId: string, network?: NetworkName | string | undefined): Promise<IResolvedResource | undefined> {
		try {
			const name = await this.getNameFromTokenId(tokenId, network);
			if (!name) {
				return undefined;
			}

			const mappedName = NameTools.mapName(name);
			if (!mappedName) {
				return undefined;
			}

			return this.generateResolvedResource(mappedName, tokenId, network);
		}
		catch {
			return undefined;
		}
	}

	public async reverseResolve(address: string, network?: NetworkName | string | undefined): Promise<string | undefined> {
		let readContracts: ContractConnection[] = [];
		if (network) {
			const readContract = this.getReadContractConnection(network);
			if (readContract) {
				readContracts.push(readContract);
			}
		} else {
			readContracts = this.readContractConnections;
		}

		for (const readContractConnection of readContracts) {
			try {
				const reverseOfRes: ethers.BigNumber | string | undefined = await readContractConnection.contract.reverseOf(address);
				if (reverseOfRes) {
					const tokenId = reverseOfRes.toString();
					if (tokenId !== "0") {
						return tokenId;
					}
				}
			}
			catch (e) {
				continue;
			}
		}
		return undefined;
	}

	public async getTokenUri(tokenId: string, network?: NetworkName | string | undefined): Promise<string | undefined> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return undefined;
		}
		try {
			return await readContractConnection.contract.tokenURI(tokenId);
		} catch {
			return undefined;
		}
	}

	public async getMetadata(tokenId: string, network?: NetworkName | string | undefined): Promise<any | undefined> {
		const tokenUri = await this.getTokenUri(tokenId, network);
		if (!tokenUri) {
			return undefined;
		}
		try {
			return ApiCaller.getHttpsCall(tokenUri);
		}
		catch {
			return undefined;
		}
	}

	public async getImageUrl(tokenId: string, network?: NetworkName | string | undefined): Promise<string | undefined> {
		const metadata = await this.getMetadata(tokenId, network);
		return metadata?.image;
	}

	public async exists(tokenId: string, network?: NetworkName | string | undefined): Promise<boolean> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return false;
		}
		try {
			return await readContractConnection.contract.exists(tokenId);
		}
		catch {
			return false;
		}
	}

	public async getOwnerAddress(tokenId: string, network?: NetworkName | string | undefined): Promise<string | undefined> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return undefined;
		}
		try {
			return await readContractConnection.contract.ownerOf(tokenId);
		}
		catch {
			return undefined;
		}
	}

	public async isApprovedOrOwner(tokenId: string, addressToCheck: string, network?: NetworkName | string | undefined): Promise<boolean> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return false;
		}

		try {
			return await readContractConnection.contract.isApprovedOrOwner({ tokenId, address: addressToCheck });
		}
		catch {
			return false;
		}
	}

	public async getRecord(tokenId: string, key: string, network?: NetworkName | string | undefined): Promise<string | undefined> {
		const readContractConnection: ContractConnection | undefined = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return undefined;
		}

		try {
			return await readContractConnection.contract.get({ key, tokenId });
		}
		catch {
			return undefined;
		}
	}

	public async getManyRecords(tokenId: string, keys: string[], network?: NetworkName | string | undefined): Promise<string[] | undefined> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return undefined;
		}

		try {
			return await readContractConnection.contract.getMany({ keys, tokenId });
		} catch {
			return undefined;
		}
	}

	public async transfer(resource: IResolvedResource, addressTo: string, signer: ethers.Signer): Promise<boolean> {
		const writeContract = this.getWriteContractWithSigner(resource.network, signer);
		if (!writeContract) {
			return false;
		}
		try {
			return await writeContract.transferFrom(resource.ownerAddress, addressTo, resource.tokenId);
		} catch (e) {
			return false;
		}
	}

	public async setApproved(resource: IResolvedResource, addressToApprove: string, signer: ethers.Signer): Promise<boolean> {
		const writeContract = this.getWriteContractWithSigner(resource.network, signer);
		if (!writeContract) {
			return false;
		}
		try {
			return await writeContract.approve(addressToApprove, resource.tokenId);
		} catch (e) {
			return false;
		}
	}

	public async setRecord(resource: IResolvedResource, key: string, value: string, signer: Wallet | ethers.Signer): Promise<boolean> {
		const writeContract = this.getWriteContractWithSigner(resource.network, signer);
		if (!writeContract) {
			return false;
		}
		try {
			return await writeContract.set(key, value, resource.tokenId);
		} catch (e) {
			return false;
		}
	}

	public async setRecords(resource: IResolvedResource, keys: string[], values: string[], signer: Wallet | ethers.Signer): Promise<boolean> {
		const writeContract = this.getWriteContractWithSigner(resource.network, signer);
		if (!writeContract) {
			return false;
		}
		try {
			return await writeContract.setMany(keys, values, resource);
		} catch (e) {
			return false;
		}
	}

	public async setReverse(resource: IResolvedResource, signer: ethers.Signer): Promise<boolean> {
		const writeContract = this.getWriteContractWithSigner(resource.network, signer);
		if (!writeContract) {
			return false;
		}
		try {
			return await writeContract.setReverse(resource.tokenId);
		} catch (e) {
			return false;
		}
	}

	protected async generateResolvedResource(mappedName: MappedName, tokenId: string, network?: NetworkName | string): Promise<IResolvedResource | undefined> {
		const readContractConnection = await this.getReadContractConnectionFromToken(tokenId, network);
		if (!readContractConnection) {
			return undefined;
		}

		const writeContractConnection = await this.getWriteContractConnection(readContractConnection.network);
		if (!writeContractConnection) {
			return undefined;
		}

		const ownerAddress = await this.getOwnerAddress(tokenId, readContractConnection.network);
		if (!ownerAddress) {
			return undefined;
		}

		const tokenUri = await this.getTokenUri(tokenId, readContractConnection.network);

		const metadata = await this.getMetadata(tokenId, readContractConnection.network);

		const records = await this.getRecords(tokenId, readContractConnection.network);

		const resolverResourceType: ResolvedResourceType = NameTools.getResolvedResourceType(mappedName.type);

		const _tokenId = readContractConnection.getTokenId(mappedName.fullname);
		const resolvedResource = new ResolvedResource({
			fullname: mappedName.fullname,
			tld: mappedName.tld,
			type: resolverResourceType,
			tokenId: _tokenId as string,
			resolverName: this._name,
			resolverProvider: this,
			imageUrl: metadata?.image_url,
			metadataUri: tokenUri,
			network: readContractConnection.network,
			ownerAddress: ownerAddress,
			proxyReaderAddress: readContractConnection.address,
			proxyWriterAddress: writeContractConnection.address,
			domain: mappedName.domain,
			metadata: metadata,
			records: records,
		});

		return resolvedResource;
	}

	protected async getTokenIdNetwork(tokenId: string): Promise<NetworkName | string | undefined> {
		for (const readContractConnection of this.readContractConnections) {
			const exists = await readContractConnection.contract.exists(tokenId);
			if (exists) {
				return readContractConnection.network;
			}
		}
	}

	protected async getReadContractConnectionFromToken(tokenId: string, network?: NetworkName | string | undefined): Promise<ContractConnection | undefined> {
		let networkToUse: NetworkName | string | undefined = network;
		if (!network) {
			networkToUse = await this.getTokenIdNetwork(tokenId);
		}
		if (!networkToUse) {
			return undefined;
		}
		const readContractConnection = this.getReadContractConnection(networkToUse);
		if (!readContractConnection) {
			return undefined;
		}

		return readContractConnection;
	}

	abstract generateTokenId(mappedName: MappedName, network?: NetworkName): Promise<string | undefined>

	abstract getNetworkFromName(mappedName: MappedName): Promise<NetworkName | string | undefined>

	abstract getRecords(tokenId: string, network?: NetworkName | string | undefined): Promise<{ [key: string]: string } | undefined>

	abstract getNameFromTokenId(tokenId: string, network?: NetworkName | string | undefined): Promise<string | undefined>
}