# react-native-runiosdevteam
Plugin for React Native to allow the selection of the development team for building/running on a device.

This is useful for completely automated deployment. 

# Usage
```
yarn add react-native-runios-withdevteam
react-native runios --device --development-team [your 10-digit development team ID]
```
# Notes
1) The command is `runios`, vs the standard RN `run-ios`. This plugin adds support for setting the development team, which RN does not at this time. 

2) If you leave the development-team parameter blank, it will used the saved ID in your `~/.rninfo` file. 

3) This package may not be necessary if you have only one developer account (e.g. you do not belong to an organization)

# Pipelining! 
Completely automate the deployment to device - no XCode required! 
```
react-native init myproject
cd myproject
yarn add react-native-bundlebase \
react-native-runios-withdevteam
react-native link
react-native runios --device --development-team [MYTEAMUUID]
```

Wait about 5-10 minutes, and enjoy on your phone! 

**Note** The above assumes you have the keys for your organization safely on your machine - otherwise, you need to synch those. But that is per-machine and per-organization - not per project! 
