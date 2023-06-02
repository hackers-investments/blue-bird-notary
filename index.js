const ethers = require("ethers");

require("dotenv").config();

const ABI = [
    "event NewLock(address owner, uint256 lockId, uint256 toChain, address payToken, uint256 payTokenAmount, address buyToken, uint256 buyTokenAmount)",
    "event SetRecipient(uint256 lockId, address recipient, uint256 recipientLockId)",
    "event Executed(uint256 lockId)",
    "event Canceled(uint256 lockId)",
    "event RequestCancel(uint256 lockId)",
    "function hash(uint256 lockId, string memory action) external view returns (bytes32)",
    "function execute(uint256 lockId, bytes32 digest, uint8 v, bytes32 r, bytes32 s) external"
];

const db = {};

const cancleKeys = {};
const executeKeys = {};

const createEventHandler = async (rpcUrl, contractAddr) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", provider);
    const contract = new ethers.Contract(contractAddr, ABI, signer);

    const fromChain = ((await provider.getNetwork()).chainId).toString();

    contract.on("NewLock", (owner, lockId, toChain, payToken, payTokenAmount, buyToken, buyTokenAmount) => {
        if (!(fromChain in db)) {
            db[fromChain] = {};
        }

        const strLockId = lockId.toString();
        if (!(strLockId in db[fromChain])) {
            db[fromChain][strLockId] = {};
        }

        db[fromChain][strLockId]["owner"] = owner;
        db[fromChain][strLockId]["toChain"] = toChain.toString();

        console.log(`FromChain: ${fromChain}, LockId: ${lockId}`);
        console.log(db[fromChain][strLockId]);
    });

    contract.on("SetRecipient", async (lockId, recipient, recipientLockId) => {
        const strLockId = lockId.toString();
        const strRecipientLockId = recipientLockId.toString();

        db[fromChain][strLockId]["recipient"] = recipient;
        db[fromChain][strLockId]["recipientLockId"] = strRecipientLockId;

        // 대상 체인에서 현재 Lock을 대상으로 지정한 Token Locker가 있는지 확인
        const toChain = db[fromChain][strLockId]["toChain"];
        if (toChain in db && strRecipientLockId in db[toChain]) {
            if ("recipientLockId" in db[toChain][strRecipientLockId]
                && db[toChain][strRecipientLockId]["recipientLockId"] === strLockId
                && "recipient" in db[toChain][strRecipientLockId]
                && db[toChain][strRecipientLockId]["recipient"] === db[fromChain][strLockId]["owner"]) {
                const hash = await contract.hash(lockId, "EXECUTE");
                const signature = await signer.signMessage(ethers.getBytes(hash));

                const r = signature.slice(0, 66);
                const s = '0x' + signature.slice(66, 130);
                const v = '0x' + signature.slice(130, 132);

                if (!(fromChain in executeKeys)) {
                    executeKeys[fromChain] = {};
                }
                executeKeys[fromChain][strLockId] = {};
                executeKeys[fromChain][strLockId]['v'] = v;
                executeKeys[fromChain][strLockId]['r'] = r;
                executeKeys[fromChain][strLockId]['s'] = s;

                if (!(toChain in executeKeys)) {
                    executeKeys[toChain] = {};
                }
                executeKeys[toChain][strRecipientLockId] = {};
                executeKeys[toChain][strRecipientLockId]['v'] = v;
                executeKeys[toChain][strRecipientLockId]['r'] = r;
                executeKeys[toChain][strRecipientLockId]['s'] = s;

                // delete db[fromChain][strLockId];
                // delete db[toChain][strRecipientLockId];
                console.log("[ Execute Keys ]");
                console.log(executeKeys);
            }
        }
    });

    contract.on("Executed", (lockId) => {
        // const strLockId = lockId.toString();

        // delete executeKeys[fromChain][strLockId];
    });

    contract.on("RequestCancel", async (lockId) => {
        const strLockId = lockId.toString();
        const toChain = db[fromChain][strLockId]["toChain"];
        const strRecipientLockId = db[fromChain][strLockId]["recipientLockId"];

        // 실행키가 이미 배포된 경우 취소키를 배포하지 않고 반환
        if (fromChain in executeKeys && strLockId in executeKeys[fromChain]) {
            return;
        }

        const hash = await contract.hash(lockId, "CANCEL");
        const signature = await signer.signMessage(ethers.getBytes(hash));

        const r = signature.slice(0, 66);
        const s = '0x' + signature.slice(66, 130);
        const v = '0x' + signature.slice(130, 132);

        if (!(fromChain in cancleKeys)) {
            cancleKeys[fromChain] = {};
        }
        cancleKeys[fromChain][strLockId] = {};
        cancleKeys[fromChain][strLockId]['v'] = v;
        cancleKeys[fromChain][strLockId]['r'] = r;
        cancleKeys[fromChain][strLockId]['s'] = s;

        if (!(toChain in cancleKeys)) {
            cancleKeys[toChain] = {};
        }
        cancleKeys[toChain][strRecipientLockId] = {};
        cancleKeys[toChain][strRecipientLockId]['v'] = v;
        cancleKeys[toChain][strRecipientLockId]['r'] = r;
        cancleKeys[toChain][strRecipientLockId]['s'] = s;

        console.log("[ Cancel Keys ]");
        console.log(cancleKeys);

        // delete db[fromChain][strLockId];
        // delete db[toChain][strRecipientLockId];
    });

    contract.on("Canceled", (lockId) => {
        // const strLockId = lockId.toString();

        // delete cancleKeys[fromChain][strLockId];
    });
}

(() => {
    createEventHandler(process.env.ETHEREUM_RPC_SERVER, process.env.ETHEREUM_CONTRACT_ADDRESS);
    // createEventHandler(process.env.POLYGON_RPC_SERVER, process.env.POLYGON_RPC_SERVER);
    // createEventHandler(process.env.AVALANCHE_RPC_SERVER, process.env.AVALANCHE_RPC_SERVER);
})();