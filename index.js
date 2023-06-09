require("dotenv").config();

const ethers = require("ethers");

const express = require('express')
const app = express()
const port = 8080

const contractAddresses = {
    5: process.env.GOERLI_CONTRACT_ADDRESS,
    137: process.env.POLYGON_CONTRACT_ADDRESS,
}

const providers = {
    0: new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/f95fcbaa5a2f42b580019e13527c4566"), // Ethereum mainnet
    5: new ethers.JsonRpcProvider("https://goerli.infura.io/v3/f95fcbaa5a2f42b580019e13527c4566"), // Goerli testnet
    137: new ethers.JsonRpcProvider("https://polygon-mainnet.infura.io/v3/f95fcbaa5a2f42b580019e13527c4566"), // Polygon mainnet
};

// personal_sign()을 호출하기 위한 signer, 네트워크는 어디에 연결하든 상관없음
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, providers[0]);

const ABI = [
    "function locks(uint256 lockId) public view returns (address owner, uint256 toChainId, address payToken, uint256 payTokenAmount, address buyToken, uint256 buyTokenAmount, bool executed, bool cancelled)",
    "function recipients(uint256 lockId) public view returns (address recipient, uint256 recipientLockId)",
    "function isRequestCancel(uint256 lockId) public view returns (bool)",
    "function hash(uint256 lockId, string memory action) external view returns (bytes32)",
    "function getLockInfo(uint256 lockId) public view returns (address, uint256, address, uint256, bool)",
];

app.get('/requestCancel', async (req, res) => {
    const chainId = Number(req.query.chain_id)
    const lockId = Number(req.query.lock_id);

    const provider = providers[chainId];
    const fromChainContract = new ethers.Contract(contractAddresses[chainId], ABI, provider);
    // 현재 체인에서 취소하려는 Lock에 대한 정보를 읽음
    const [owner, toChainId, recipient, recipientLockId, isRequestCancel] = await fromChainContract.getLockInfo(lockId);

    // recipient를 지정했는지 확인함. recipient를 지정하지 않은 경우 바로 취소 가능.
    if (recipient === ethers.ZeroAddress) {
        const response = {
            error: true,
            reason: "No need notary sign"
        };
        res.json(response);
        return;
    }

    // Lock에 대한 requestCancel() 호출 여부 검증
    if (isRequestCancel === false) {
        const response = {
            error: true,
            reason: "Request cancel first"
        };
        res.json(response);
        return;
    }

    const toChainProvider = providers[Number(toChainId)];
    const toChainContract = new ethers.Contract(contractAddresses[Number(toChainId)], ABI, toChainProvider);
    // 반대편 체인에서 취소하려는 Lock에 대한 정보를 읽음
    const [, , toChainRecipient, toChainRecipientLockId,] = await toChainContract.getLockInfo(Number(recipientLockId));

    // 상대방이 recipient를 지정하지 않았거나, recipient가 취소를 요청한 사용자가 아닌 경우에만 sign 발행
    if (toChainRecipient === ethers.ZeroAddress || toChainRecipient !== owner || Number(toChainRecipientLockId) !== lockId) {
        const hash = await fromChainContract.hash(lockId, "CANCEL");
        const signature = await signer.signMessage(ethers.getBytes(hash));

        const r = signature.slice(0, 66);
        const s = '0x' + signature.slice(66, 130);
        const v = '0x' + signature.slice(130, 132);

        res.json({
            digest: hash,
            r: r,
            s: s,
            v: v
        });
        return;
    } else {
        const response = {
            error: true,
            reason: "Aready done"
        };
        res.json(response);
        return;
    }
})

app.get('/requestExecute', async (req, res) => {
    const chainId = Number(req.query.chain_id)
    const lockId = Number(req.query.lock_id);

    const provider = providers[chainId];
    const fromChainContract = new ethers.Contract(contractAddresses[chainId], ABI, provider);
    // 현재 체인에서 취소하려는 Lock에 대한 정보를 읽음
    const [owner, toChainId, recipient, recipientLockId, isRequestCancel] = await fromChainContract.getLockInfo(lockId);

    if (isRequestCancel !== false) {
        const response = {
            error: true,
            reason: "It's not executable because it's already cancelled"
        };
        res.json(response);
        return;
    }

    // recipient를 지정했는지 확인
    if (recipient === ethers.ZeroAddress) {
        const response = {
            error: true,
            reason: "setRecipient() first"
        };
        res.json(response);
        return;
    }

    const toChainProvider = providers[Number(toChainId)];
    const toChainContract = new ethers.Contract(contractAddresses[Number(toChainId)], ABI, toChainProvider);
    const [, , toChainRecipient, toChainRecipientLockId, toChainIsRequestCancel] = await toChainContract.getLockInfo(Number(recipientLockId));

console.log(toChainRecipient);
	console.log(owner);

    // 상대방도 나를 recipient로 지정했는지 확인
    if (toChainRecipient === owner) {
        // 상대방이 취소하기 위해 requestCancel()를 호출했는지 확인
        if (toChainIsRequestCancel === true) {
            const response = {
                error: true,
                reason: "It's not executable because it's already cancelled"
            };
            res.json(response);
            return;
        } else {
            const hash = await fromChainContract.hash(lockId, "EXECUTE");
            const signature = await signer.signMessage(ethers.getBytes(hash));

            const r = signature.slice(0, 66);
            const s = '0x' + signature.slice(66, 130);
            const v = '0x' + signature.slice(130, 132);

            res.json({
                digest: hash,
                r: r,
                s: s,
                v: v
            });
            return;
        }
    } else {
        const response = {
            error: true,
            reason: "It's not executable"
        };
        res.json(response);
        return;
    }
})

app.listen(port, () => {
    console.log(`BlueBird Notary ${port}`)
})
