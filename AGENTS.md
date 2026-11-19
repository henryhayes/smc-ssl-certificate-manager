# SMC SSL Certificate Manager

This application does one thing - provides a means to replace the default SSL certificate on the device, located at `/var/local/conf/https.key` and `/var/local/conf/https.pem`

### Supported Functions

- Write a browser based certificate issuing platform that can automatically create a certificate using Let's Encrypt and automatically upload it to the SMC Gateway. This is the primary function.

- User should be able to specify their intended hostname, example: `example.smc-gateway.com`.
- Using the same code, as a backup option - to manually upload manually to `/var/local/conf/https.key` and `/var/local/conf/https.pem`.

## Development

Build on the skeleton app located `./` for all development, but use the `References` below.

## References

Use the following for reference:

- `../SMC File Manager (Provided by SMC Gateway)/` (how to upload files to any SMC gateway)
- `../SMC SSH Key Upload Tool (Provided by SMC Gateway)/` (
- `../Intaverge Express/`

## Restrictions

- This is an admin role level app, and therefore should have a gate that stops any user that does not have the `user.role="admin"` from accessing the app. SMC Gateway already prevents non `user.role="admin"` users from uploadiong files anyway.
- SSH access as username `user@gateway` with restricted access.

## Factory-resettable "testbench" SMC Gateway

- Base URL: "10.17.66.8"
- Administrator login: `admin`
- Administrator password: `testbench`
- User-role test login: `user`
- User-role test password: `testbenchuser`

App Installed Browser Location: http://10.17.66.8/

