import { ethers } from "ethers";
import { Config } from "sst/node/config";
const axios = require("axios");


const fraxtal = Config.FRAXTAL_URL;
const mainnet = Config.MAINNET_URL;
const pk = Config.PK;
const tgToken = Config.tgToken;

const SFRX_ETH_MAINNET = "0xac3E018457B222d93114458476f3E3416Abbe38F";
const FRAXTAL_L2_ORACLE = "0x8865435777730eAAbAAF2d1F55F115a87AbCf91A";
const FRAXTAL_L2_PROOVER = "0xa560E014501f96752726f65c27E96C3e9127Ce32";

export async function main() {
    await pushNotification("👟 Function initiated 👟");
    await run();
    return {};
}


async function pushNotification(msg: String) {
    const API_URL_SEND = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const payload = {
        chat_id: "-4101411507",
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



async function proveStateRoot() {
    const fraxtalProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: fraxtal
    });
    const mainnetProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: mainnet
    });
    let wallet = new ethers.Wallet(pk, fraxtalProvider);

    // Fetch most recent block from the L1 provider on Fraxtal
    let l1PoviderFraxtal = new ethers.Contract(
        "0x4200000000000000000000000000000000000015",
        L1_PROVIDER,
        wallet
    );
    let blockL1 = await l1PoviderFraxtal.number();

    let mainnetHeader = await getHeaderFromBlock(mainnetProvider, blockL1.toHexString());
    
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


async function run() {
    const mainnetProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: mainnet
    });
    const fraxtalProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: fraxtal
    });
    let wallet = new ethers.Wallet(pk, fraxtalProvider)

    // If the totalAssetStored Slot is the same -> No need to push proof
    // let slot = await mainnetProvider.getStorageAt(SFRX_ETH_MAINNET, 7);
    // console.log("The slot value: ", (slot));

    let toCheck = new ethers.Contract(
        SFRX_ETH_MAINNET,
        SFRX_ETH_ABI,
        mainnetProvider
    );

    let toPost = new ethers.Contract(
        FRAXTAL_L2_ORACLE,
        ERC4626_VAULT,
        fraxtalProvider
    );
    let proover = new ethers.Contract(
        FRAXTAL_L2_PROOVER,
        ERC4626PROVER,
        wallet
    );


    let res_main = await toCheck.previewRedeem(ethers.utils.parseUnits("1"));
    let res_fraxtal = await toPost.getPrices();
    let diff = res_main.sub(res_fraxtal[1]).abs();
    let threshold = ethers.utils.parseEther("0.00000001")

    // let totalAssetStoredL2 = await toPost.storedTotalAssets();
    // console.log(totalAssetStoredL2.toHexString(), "0x"+slot.substring(2).replace(/^0+/, ""));
    // console.log(totalAssetStoredL2.toHexString() == "0x"+slot.substring(2).replace(/^0+/, ""));
    if (diff.gt(threshold)) {
        console.log("Condition hit");
        // proveStateRoot();
        let blockL1 = await proveStateRoot();
        let blockToProof = "0x"+blockL1.toHexString().substring(2).replace(/^0+/, "");
        let proofSfrx_ts = await mainnetProvider.send("eth_getProof", 
        [
            SFRX_ETH_MAINNET, 
            ["0x0000000000000000000000000000000000000000000000000000000000000002"], 
            blockToProof
        ]);
        let proofSfrx_ta = await mainnetProvider.send("eth_getProof", 
        [
            SFRX_ETH_MAINNET, 
            ["0x0000000000000000000000000000000000000000000000000000000000000007"], 
            blockToProof
        ]);

        let proofSfrx_rewards = await mainnetProvider.send("eth_getProof", 
        [
            SFRX_ETH_MAINNET, 
            ["0x0000000000000000000000000000000000000000000000000000000000000006"], 
            blockToProof
        ]);
        const count = await fraxtalProvider.getTransactionCount(wallet.address);
        let nextNonce = count + 1;
        let txn = await proover.addRoundDataSfrxEth(
            FRAXTAL_L2_ORACLE,
            blockL1.toString(),
            proofSfrx_ta.accountProof,
            proofSfrx_ts.storageProof[0].proof,
            proofSfrx_ta.storageProof[0].proof,
            proofSfrx_rewards.storageProof[0].proof, {
                gasLimit: 1_909_705,
                maxFeePerGas: 1e6 - 1,
                maxPriorityFeePerGas: 1e6 - 1,
                nonce: count + 1
            }
        );
        txn.wait();
        await pushNotification(`🟢 Vault Info Pushed to L2 🟢 \n [Transaction](https://fraxscan.com/tx/${txn.hash})`);
    } else {
        console.log("There is nothing to proof");
        await pushNotification(`☑️ Vault on L2 current w/ L1 ☑️\n The difference is ${diff.toString()} \n The threshold is ${threshold.toString()}`);
    }
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
const SFRX_ETH_ABI = [{"inputs":[{"internalType":"contract ERC20","name":"_underlying","type":"address"},{"internalType":"uint32","name":"_rewardsCycleLength","type":"uint32"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"SyncError","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"caller","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint32","name":"cycleEnd","type":"uint32"},{"indexed":false,"internalType":"uint256","name":"rewardAmount","type":"uint256"}],"name":"NewRewardsCycle","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"caller","type":"address"},{"indexed":true,"internalType":"address","name":"receiver","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Withdraw","type":"event"},{"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"asset","outputs":[{"internalType":"contract ERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"convertToAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"convertToShares","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"}],"name":"deposit","outputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"bool","name":"approveMax","type":"bool"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"depositWithSignature","outputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"lastRewardAmount","outputs":[{"internalType":"uint192","name":"","type":"uint192"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastSync","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"}],"name":"mint","outputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pricePerShare","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"redeem","outputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"rewardsCycleEnd","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"rewardsCycleLength","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"syncRewards","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"withdraw","outputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}];
const ERC4626PROVER = [{"inputs":[{"internalType":"address","name":"_stateRootOracle","type":"address"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[{"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAlreadySet","type":"error"},{"inputs":[],"name":"StalePush","type":"error"},{"inputs":[],"name":"WrongOracleAddress","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"indexed":true,"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"STATE_ROOT_ORACLE","outputs":[{"internalType":"contract IStateRootOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"layer1FraxOracle","type":"address"},{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"internalType":"struct MerkleProofPriceSourceSfrxEth.OraclePair[]","name":"_oraclePairs","type":"tuple[]"}],"name":"addOraclePairs","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IERC4626Receiver","name":"_sfrxEthAddress","type":"address"},{"internalType":"uint256","name":"_blockNumber","type":"uint256"},{"internalType":"bytes[]","name":"_accountProofSfrxEth","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofTotalSupply","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofTotalAssets","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofRewards","type":"bytes[]"}],"name":"addRoundDataSfrxEth","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"name":"oracleLookup","outputs":[{"internalType":"address","name":"layer1FraxOracle","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"name":"oracleToLastBlockProofed","outputs":[{"internalType":"uint256","name":"lastBlockProofed","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}]
const ERC4626_VAULT = [{"inputs":[{"internalType":"address","name":"_timelock","type":"address"},{"internalType":"address","name":"_priceSource","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyPriceSource","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"SamePriceSource","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"oldPriceSource","type":"address"},{"indexed":false,"internalType":"address","name":"newPriceSource","type":"address"}],"name":"SetPriceSource","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"totalSupply","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalStoredAssets","type":"uint256"},{"indexed":false,"internalType":"uint192","name":"lastRewards","type":"uint192"},{"indexed":false,"internalType":"uint32","name":"rewardsCycleEnd","type":"uint32"},{"indexed":false,"internalType":"uint32","name":"lastSync","type":"uint32"}],"name":"VaultDataUpdated","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"_decimals","type":"uint8"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"description","outputs":[{"internalType":"string","name":"_description","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"getPrices","outputs":[{"internalType":"bool","name":"isBadData","type":"bool"},{"internalType":"uint256","name":"_priceLow","type":"uint256"},{"internalType":"uint256","name":"_priceHigh","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastRewardAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastSync","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"_name","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"priceSource","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"rewardsCycleEnd","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newPriceSource","type":"address"}],"name":"setPriceSource","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"storedTotalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_totalSupply","type":"uint256"},{"internalType":"uint256","name":"_totalAssets","type":"uint256"},{"internalType":"uint192","name":"_lastRewardsAmount","type":"uint192"},{"internalType":"uint32","name":"_rewardsCycleEnd","type":"uint32"},{"internalType":"uint32","name":"_lastSync","type":"uint32"}],"name":"updateErc4262VaultData","outputs":[],"stateMutability":"nonpayable","type":"function"}]
const L1_PROVIDER = [{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"blockHash","type":"bytes32"}],"name":"BlockHashReceived","type":"event"},{"inputs":[],"name":"DEPOSITOR_ACCOUNT","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"baseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"basefee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"batcherHash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_blockHash","type":"bytes32"}],"name":"blockHashStored","outputs":[{"internalType":"bool","name":"_result","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"hash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeOverhead","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeScalar","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"number","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"sequenceNumber","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint64","name":"_number","type":"uint64"},{"internalType":"uint64","name":"_timestamp","type":"uint64"},{"internalType":"uint256","name":"_basefee","type":"uint256"},{"internalType":"bytes32","name":"_hash","type":"bytes32"},{"internalType":"uint64","name":"_sequenceNumber","type":"uint64"},{"internalType":"bytes32","name":"_batcherHash","type":"bytes32"},{"internalType":"uint256","name":"_l1FeeOverhead","type":"uint256"},{"internalType":"uint256","name":"_l1FeeScalar","type":"uint256"}],"name":"setL1BlockValues","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"setL1BlockValuesEcotone","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"storedBlockHashes","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timestamp","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]
const STATEROOT_ORACLE = [{"inputs":[{"internalType":"contract IBlockHashProvider[]","name":"_providers","type":"address[]"},{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"MinimumRequiredProvidersTooLow","type":"error"},{"inputs":[],"name":"NotEnoughProviders","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"ProviderAlreadyAdded","type":"error"},{"inputs":[],"name":"ProviderNotFound","type":"error"},{"inputs":[],"name":"SameMinimumRequiredProviders","type":"error"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"StateRootAlreadyProvenForBlockNumber","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint40","name":"blockNumber","type":"uint40"},{"indexed":false,"internalType":"uint40","name":"timestamp","type":"uint40"},{"indexed":false,"internalType":"bytes32","name":"stateRootHash","type":"bytes32"}],"name":"BlockVerified","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderRemoved","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldMinimumRequiredProviders","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newMinimumRequiredProviders","type":"uint256"}],"name":"SetMinimumRequiredProviders","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"addProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"blockHashProviders","outputs":[{"internalType":"contract IBlockHashProvider","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"blockNumberToBlockInfo","outputs":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getBlockHashProvidersCount","outputs":[{"internalType":"uint256","name":"_providersCount","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_blockNumber","type":"uint256"}],"name":"getBlockInfo","outputs":[{"components":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"internalType":"struct IStateRootOracle.BlockInfo","name":"_blockInfo","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"minimumRequiredProviders","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"_blockHeader","type":"bytes"}],"name":"proveStateRoot","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"removeProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"}],"name":"setMinimumRequiredProviders","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}];