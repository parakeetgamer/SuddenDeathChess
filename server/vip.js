// Usernames here ALWAYS have premium (+ a special VIP crown), no payment needed.
// Add a username (lowercase) to grant it permanently. Case-insensitive.
const VIP_USERS = ['goose'];
function isVip(username) {
  return !!username && VIP_USERS.indexOf(String(username).toLowerCase()) >= 0;
}
module.exports = { VIP_USERS, isVip };
