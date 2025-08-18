const { ethers } = require("ethers");
const waveFlipAbi = require("../abi/WaveFlip.json");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const waveFlip = new ethers.Contract(process.env.WAVE_FLIP_ADDR, waveFlipAbi, signer);

async function withdrawFunds(token, amount) {
  const tx = await waveFlip.withdraw(token, amount);
  await tx.wait();
  return tx;
}

async function pauseGame() {
  const tx = await waveFlip.pause();
  await tx.wait();
  return tx;
}

async function unpauseGame() {
  const tx = await waveFlip.unpause();
  await tx.wait();
  return tx;
}

module.exports = { withdrawFunds, pauseGame, unpauseGame };
