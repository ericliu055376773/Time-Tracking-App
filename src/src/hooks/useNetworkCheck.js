export async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

export async function getLocalIP() {
  return null;
}

export async function getNetworkInfo() {
  const publicIP = await getPublicIP();
  return { publicIP, localIP: null };
}

export function isAllowedNetwork(currentPublicIP, currentLocalIP, allowedNetworks) {
  if (!allowedNetworks || allowedNetworks.length === 0)
    return { allowed: false, reason: '尚未設定允許打卡的 WiFi' };
  for (const net of allowedNetworks) {
    if (net.publicIP && currentPublicIP && net.publicIP === currentPublicIP)
      return { allowed: true, matchedNetwork: net.name };
    if (net.localSubnet && currentLocalIP) {
      const s = currentLocalIP.split('.').slice(0, 3).join('.');
      if (net.localSubnet === s)
        return { allowed: true, matchedNetwork: net.name };
    }
  }
  return { allowed: false, reason: '目前網路不在允許的 WiFi 範圍內，請連接辦公室 WiFi' };
}
