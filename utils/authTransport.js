function createAuthTransport(http) {
  const loginOptions = credential => ({
    credentialScope: 'login', credential, invalidateOn401: false
  });
  return Object.freeze({
    async validateLogin(credential) {
      const response = await http.get('/user/getMainMessage', {}, loginOptions(credential));
      return response.data || {};
    },
    async listBoundDevices(credential) {
      const response = await http.get('/user/bind/status', {}, loginOptions(credential));
      return Array.isArray(response.data) ? response.data : [];
    },
    async validateDevice(credential, deviceId) {
      const response = await http.get('/user/bind/status', { deviceId }, {
        ...loginOptions(credential), deviceId
      });
      return response.data || {};
    }
  });
}
module.exports = { createAuthTransport };
