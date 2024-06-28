import { ethers } from "ethers";
import { Config } from "sst/node/config";
const axios = require("axios");

const fraxtal = Config.FRAXTAL_URL;
const mainnet = Config.MAINNET_URL;
const pk = Config.PK;
const tgToken = Config.tgToken;

const SDAI_POT_MAINNET = "0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7";
const SDAI_ORACLE_FRAXTAL = "0xfdE8C36F32Bf32e73A1bdeb4ef3E17709674a838";
const SDAI_PROOFER = "0xf3E3E2a376939bfF87e9cac84e0E5A35e495417a";

export async function main() {
    await pushNotification("👟 Function initiated 👟");
    await run();
    return {};
}

const SUSDE_PROVER = "0xc2B984E37D1CAf5Eef82D9D892287361058955E9";
const SUSDE_ORACLE = "0xd295936C8Bb465ADd1eC756a51698127CB4F4910";
const SUSDE_MAINNET = "0x9d39a5de30e57443bff2a8307a4256c8797a3497";
const USDE_MAINNET = "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3";
const SUSDE_BALANCE_SLOT = "0x396a2330c3e96731d20b554a4cd7844bd51ef95f0419f3cf9913a09b68863984";

type Proof = {
    _accountProofSUSDe: any,
    _storageProofTS: any,
    _storageProofLastDist: any,
    _storageProofVestingAmount: any,
    _accountProofUSDe: any,
    _storageProofUSDeBalance: any
}


async function proveStateRoot(
    wallet: ethers.Wallet, 
    mainnet: ethers.providers.JsonRpcProvider
) {

    // Fetch most recent block from the L1 provider on Fraxtal
    let l1PoviderFraxtal = new ethers.Contract(
        "0x4200000000000000000000000000000000000015",
        L1_PROVIDER,
        wallet
    );
    let blockL1 = await l1PoviderFraxtal.number();

    let mainnetHeader = await getHeaderFromBlock(mainnet, blockL1.toHexString());
    
    let fraxtalStateRootOracle = new ethers.Contract(
        "0xeD403d48e2bC946438B5686AA1AD65056Ccf9512",
        STATEROOT_ORACLE,
        wallet
    );
    // Prover Header on L2 
    let txn = await fraxtalStateRootOracle.proveStateRoot(mainnetHeader, {
        maxFeePerGas: 1e6,
        maxPriorityFeePerGas: 1e6
    });
    txn.wait();
    return blockL1
}

async function getHeaderFromBlock(provider, blockL1) {
    let block = await provider.send("eth_getBlockByNumber", [blockL1, false])
    let headerFields = [];
    headerFields.push(block.parentHash);
    headerFields.push(block.sha3Uncles);
    headerFields.push(block.miner);
    headerFields.push(block.stateRoot);
    headerFields.push(block.transactionsRoot);
    headerFields.push(block.receiptsRoot);
    headerFields.push(block.logsBloom);
    headerFields.push(block.difficulty);
    headerFields.push(block.number);
    headerFields.push(block.gasLimit);
    headerFields.push(block.gasUsed);
    headerFields.push(block.timestamp);
    headerFields.push(block.extraData);
    headerFields.push(block.mixHash);
    headerFields.push(block.nonce);
    headerFields.push(block.baseFeePerGas);
    if (block.withdrawalsRoot) {
        headerFields.push(block.withdrawalsRoot);
    }
    if (block.blobGasUsed) {
        headerFields.push(block.blobGasUsed);
    }
    if (block.excessBlobGas) {
        headerFields.push(block.excessBlobGas);
    }
    if (block.parentBeaconBlockRoot) {
        headerFields.push(block.parentBeaconBlockRoot);
    }
    convertHeaderFields(headerFields);
    let header = ethers.utils.RLP.encode(headerFields);
    return header
}

function convertHeaderFields(headerFields) {
    for (var i = 0; i < headerFields.length; i++) {
      var field = headerFields[i];
      if (field == "0x0") field = "0x";
      if (field.length % 2 == 1) field = "0x0" + field.substring(2);
      headerFields[i] = field;
    }
}

async function pushNotification(msg: String) {
    const API_URL_SEND = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const payload = {
        chat_id: "-4167478287",
        text: msg,
        disable_notifications: false,
        parse_mode: "MarkdownV2",
        link_preview_options: {
            is_disabled: true
        }
        
    }
    await axios.post(API_URL_SEND, payload, {
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

async function run() {
    const mainnetProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: mainnet
    });
    const fraxtalProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: fraxtal
    });
    let wallet = new ethers.Wallet(pk, fraxtalProvider);

    let susde = new ethers.Contract(
        SUSDE_MAINNET,
        SUSDE_ERC20,
        mainnetProvider
    );
    let toPost = new ethers.Contract(
        SUSDE_ORACLE, 
        L2ORACLE,
        fraxtalProvider
    );

    let res = await toPost.pricePerShare();
    let res_main = await susde.previewRedeem(ethers.utils.parseEther("1"));
    let diff = res_main.sub(res).abs();
    let threshold = ethers.utils.parseEther("0.00001")

    if (diff.gt(threshold)) {
        let proover = new ethers.Contract(
            SUSDE_PROVER,
            SUSDE_PROOF,
            wallet
        );
        let blockL1 = await proveStateRoot(wallet, mainnetProvider);
        let blockToProof = "0x"+blockL1.toHexString().substring(2).replace(/^0+/, "");

        let ts_proof = await mainnetProvider.send("eth_getProof", 
        [
            SUSDE_MAINNET, 
            [
                "0x0000000000000000000000000000000000000000000000000000000000000006",
                "0x000000000000000000000000000000000000000000000000000000000000000E",
                "0x000000000000000000000000000000000000000000000000000000000000000D"
            ], 
            blockToProof
        ]);
        let balance_proof = await mainnetProvider.send("eth_getProof", 
        [

            USDE_MAINNET, 
            [SUSDE_BALANCE_SLOT], 
            blockToProof
        ]);
        console.log(blockL1, blockToProof)
        console.log(ts_proof.accountProof.type);

        let proof: Proof = {} as Proof;
        proof._accountProofSUSDe = ts_proof.accountProof;
        proof._storageProofTS = ts_proof.storageProof[0].proof;
        proof._storageProofLastDist = ts_proof.storageProof[1].proof;
        proof._storageProofVestingAmount = ts_proof.storageProof[2].proof;
        proof._accountProofUSDe = balance_proof.accountProof;
        proof._storageProofUSDeBalance = balance_proof.storageProof[0].proof;
        const count = await fraxtalProvider.getTransactionCount(wallet.address);
        let txn = await proover.addRoundDataSUSDe(
            SUSDE_ORACLE,
            blockL1.toString(),
            proof, {
                gasLimit: 2_909_705,
                maxFeePerGas: 1e6 - 1,
                maxPriorityFeePerGas: 1e6 - 1,
                nonce: count + 1
            }
        );
        txn.wait();
        console.log(txn.hash);
        await pushNotification(`🟢 Vault Info Pushed to L2 🟢 \n [Transaction](https://fraxscan.com/tx/${txn.hash})`);
    } else {
        console.log("Nothing to proof");
        await pushNotification(`☑️ Vault on L2 current w/ L1 ☑️ \n The difference is ${diff.toString()} \n The threshold is ${threshold}`);   
    }
}

const L2ORACLE = [{"inputs":[{"internalType":"address","name":"_timelock","type":"address"},{"internalType":"address","name":"_priceSource","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"CastError","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyPriceSource","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"SamePriceSource","type":"error"},{"inputs":[],"name":"StalePush","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"oldPriceSource","type":"address"},{"indexed":false,"internalType":"address","name":"newPriceSource","type":"address"}],"name":"SetPriceSource","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"totalSupply","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalAssetBalance","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"vestingAmount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"lastDistributionTimestamp","type":"uint256"}],"name":"VaultDataUpdated","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"_decimals","type":"uint8"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"description","outputs":[{"internalType":"string","name":"_description","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"getPrices","outputs":[{"internalType":"bool","name":"isBadData","type":"bool"},{"internalType":"uint256","name":"_priceLow","type":"uint256"},{"internalType":"uint256","name":"_priceHigh","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getUnvestedAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastDistributionTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastL1Block","outputs":[{"internalType":"uint96","name":"","type":"uint96"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"_name","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pricePerShare","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"priceSource","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_newPriceSource","type":"address"}],"name":"setPriceSource","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssetsBalance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint96","name":"_l1BlockNumber","type":"uint96"},{"internalType":"uint256","name":"_totalSupply","type":"uint256"},{"internalType":"uint256","name":"_totalAssets","type":"uint256"},{"internalType":"uint256","name":"_vestingAmount","type":"uint256"},{"internalType":"uint256","name":"_lastDistributionTimestamp","type":"uint256"}],"name":"updateSUSDeVaultData","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"vestingAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}];
const SUSDE_PROOF = [{"inputs":[{"internalType":"address","name":"_stateRootOracle","type":"address"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"MustBeGtZero","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[{"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAlreadySet","type":"error"},{"inputs":[],"name":"StalePush","type":"error"},{"inputs":[],"name":"WrongOracleAddress","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"indexed":true,"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"STATE_ROOT_ORACLE","outputs":[{"internalType":"contract IStateRootOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"layer1FraxOracle","type":"address"},{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"internalType":"struct MerkleProofPriceSourceSUSDe.OraclePair[]","name":"_oraclePairs","type":"tuple[]"}],"name":"addOraclePairs","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IERC4626Receiver","name":"_sUSDeAddress","type":"address"},{"internalType":"uint96","name":"_blockNumber","type":"uint96"},{"components":[{"internalType":"bytes[]","name":"_accountProofSUSDe","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofTS","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofLastDist","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofVestingAmount","type":"bytes[]"},{"internalType":"bytes[]","name":"_accountProofUSDe","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofUSDeBalance","type":"bytes[]"}],"internalType":"struct MerkleProofPriceSourceSUSDe.SUSDeProof","name":"proof","type":"tuple"}],"name":"addRoundDataSUSDe","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"name":"oracleLookup","outputs":[{"internalType":"address","name":"layer1Oracle","type":"address"},{"internalType":"uint96","name":"lastBlockProofed","type":"uint96"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}]
const SUSDE_ERC20 = [{"inputs":[{"internalType":"contract IERC20","name":"_asset","type":"address"},{"internalType":"address","name":"initialRewarder","type":"address"},{"internalType":"address","name":"_owner","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"CantBlacklistOwner","type":"error"},{"inputs":[],"name":"ExcessiveRedeemAmount","type":"error"},{"inputs":[],"name":"ExcessiveWithdrawAmount","type":"error"},{"inputs":[],"name":"InvalidAdminChange","type":"error"},{"inputs":[],"name":"InvalidAmount","type":"error"},{"inputs":[],"name":"InvalidCooldown","type":"error"},{"inputs":[],"name":"InvalidShortString","type":"error"},{"inputs":[],"name":"InvalidToken","type":"error"},{"inputs":[],"name":"InvalidZeroAddress","type":"error"},{"inputs":[],"name":"MinSharesViolation","type":"error"},{"inputs":[],"name":"NotPendingAdmin","type":"error"},{"inputs":[],"name":"OperationNotAllowed","type":"error"},{"inputs":[],"name":"StillVesting","type":"error"},{"inputs":[{"internalType":"string","name":"str","type":"string"}],"name":"StringTooLong","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"oldAdmin","type":"address"},{"indexed":true,"internalType":"address","name":"newAdmin","type":"address"}],"name":"AdminTransferRequested","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"oldAdmin","type":"address"},{"indexed":true,"internalType":"address","name":"newAdmin","type":"address"}],"name":"AdminTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint24","name":"previousDuration","type":"uint24"},{"indexed":false,"internalType":"uint24","name":"newDuration","type":"uint24"}],"name":"CooldownDurationUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[],"name":"EIP712DomainChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"LockedAmountRedistributed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"RewardsReceived","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"previousAdminRole","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"newAdminRole","type":"bytes32"}],"name":"RoleAdminChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"sender","type":"address"}],"name":"RoleGranted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"sender","type":"address"}],"name":"RoleRevoked","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":true,"internalType":"address","name":"receiver","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Withdraw","type":"event"},{"inputs":[],"name":"DEFAULT_ADMIN_ROLE","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"MAX_COOLDOWN_DURATION","outputs":[{"internalType":"uint24","name":"","type":"uint24"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"acceptAdmin","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bool","name":"isFullBlacklisting","type":"bool"}],"name":"addToBlacklist","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"asset","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"convertToAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"convertToShares","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"cooldownAssets","outputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"cooldownDuration","outputs":[{"internalType":"uint24","name":"","type":"uint24"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"cooldownShares","outputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"cooldowns","outputs":[{"internalType":"uint104","name":"cooldownEnd","type":"uint104"},{"internalType":"uint152","name":"underlyingAmount","type":"uint152"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"pure","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"}],"name":"deposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"eip712Domain","outputs":[{"internalType":"bytes1","name":"fields","type":"bytes1"},{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"version","type":"string"},{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"verifyingContract","type":"address"},{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"uint256[]","name":"extensions","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"}],"name":"getRoleAdmin","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getUnvestedAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"grantRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"hasRole","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"lastDistributionTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"}],"name":"mint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"address","name":"_owner","type":"address"}],"name":"redeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"}],"name":"redistributeLockedAmount","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bool","name":"isFullBlacklisting","type":"bool"}],"name":"removeFromBlacklist","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"},{"internalType":"address","name":"","type":"address"}],"name":"renounceRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"to","type":"address"}],"name":"rescueTokens","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"revokeRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint24","name":"duration","type":"uint24"}],"name":"setCooldownDuration","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"silo","outputs":[{"internalType":"contract USDeSilo","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"newAdmin","type":"address"}],"name":"transferAdmin","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferInRewards","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"receiver","type":"address"}],"name":"unstake","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"vestingAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"address","name":"_owner","type":"address"}],"name":"withdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}];
const L1_PROVIDER = [{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"blockHash","type":"bytes32"}],"name":"BlockHashReceived","type":"event"},{"inputs":[],"name":"DEPOSITOR_ACCOUNT","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"baseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"basefee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"batcherHash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_blockHash","type":"bytes32"}],"name":"blockHashStored","outputs":[{"internalType":"bool","name":"_result","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"hash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeOverhead","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeScalar","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"number","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"sequenceNumber","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint64","name":"_number","type":"uint64"},{"internalType":"uint64","name":"_timestamp","type":"uint64"},{"internalType":"uint256","name":"_basefee","type":"uint256"},{"internalType":"bytes32","name":"_hash","type":"bytes32"},{"internalType":"uint64","name":"_sequenceNumber","type":"uint64"},{"internalType":"bytes32","name":"_batcherHash","type":"bytes32"},{"internalType":"uint256","name":"_l1FeeOverhead","type":"uint256"},{"internalType":"uint256","name":"_l1FeeScalar","type":"uint256"}],"name":"setL1BlockValues","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"setL1BlockValuesEcotone","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"storedBlockHashes","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timestamp","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]
const STATEROOT_ORACLE = [{"inputs":[{"internalType":"contract IBlockHashProvider[]","name":"_providers","type":"address[]"},{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"MinimumRequiredProvidersTooLow","type":"error"},{"inputs":[],"name":"NotEnoughProviders","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"ProviderAlreadyAdded","type":"error"},{"inputs":[],"name":"ProviderNotFound","type":"error"},{"inputs":[],"name":"SameMinimumRequiredProviders","type":"error"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"StateRootAlreadyProvenForBlockNumber","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint40","name":"blockNumber","type":"uint40"},{"indexed":false,"internalType":"uint40","name":"timestamp","type":"uint40"},{"indexed":false,"internalType":"bytes32","name":"stateRootHash","type":"bytes32"}],"name":"BlockVerified","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderRemoved","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldMinimumRequiredProviders","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newMinimumRequiredProviders","type":"uint256"}],"name":"SetMinimumRequiredProviders","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"addProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"blockHashProviders","outputs":[{"internalType":"contract IBlockHashProvider","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"blockNumberToBlockInfo","outputs":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getBlockHashProvidersCount","outputs":[{"internalType":"uint256","name":"_providersCount","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_blockNumber","type":"uint256"}],"name":"getBlockInfo","outputs":[{"components":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"internalType":"struct IStateRootOracle.BlockInfo","name":"_blockInfo","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"minimumRequiredProviders","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"_blockHeader","type":"bytes"}],"name":"proveStateRoot","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"removeProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"}],"name":"setMinimumRequiredProviders","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}];