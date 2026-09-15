const { networkInterfaces } = require("node:os");

const getLanAddresses = (interfaces = networkInterfaces()) => {
  const addresses = Object.entries(interfaces)
    .filter(([name]) => !/loopback|tailscale|vpn|virtual|vethernet|vmware|vbox|docker|wsl|bluetooth/i.test(name))
    .flatMap(([, entries]) => entries || [])
    .filter(({ family, internal, address }) => {
      if (internal || (family !== "IPv4" && family !== 4)) return false;
      const [first, second] = address.split(".").map(Number);
      return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
    })
    .map(({ address }) => address);

  return [...new Set(addresses)];
};

const getLocalAccessUrls = () => ({
  local: "http://localhost:5173/menu",
  lan: getLanAddresses().map((address) => `http://${address}:5173/auth`),
});

const printLocalAccessUrls = () => {
  const { local, lan } = getLocalAccessUrls();
  console.log(`POS komputer ini: ${local}`);
  for (const url of lan) console.log(`POS jaringan lokal: ${url}`);
  if (!lan.length) console.log("Belum ada alamat IPv4 LAN aktif.");
};

module.exports = { getLanAddresses, getLocalAccessUrls, printLocalAccessUrls };
