import fetch from "node-fetch";
import NestedError from "nested-error-stacks";
import {callAPI, search} from "../app/middleware/ledgerUtils";
import {getOrCreateApp, getOrCreateContract, getUser, getUserProfile, getOrCreateUserProfile} from "./ledger"
const url = require("url");

const dabl = () => {
    let refreshCookie = process.env.REFRESH_COOKIE;
    const dablUrl = "https://api.projectdabl.com/";
    const ledgerId = process.env.DABL_LEDGER;
    
    const ledgerSegment = `/${ledgerId}/`;
    const adminParty = process.env.DABL_ADMIN;
    const dataURL = dablUrl + "data" + ledgerSegment;

    let jwts = {};

    let appCid = null;

    const getSiteJWTInner = async () => {
        try {
            const response = await fetch(
                'https://login.projectdabl.com/auth/login',
                {
                    "credentials":"include",
                    "headers":{
                        "sec-fetch-mode":"cors",
                        "cookie" : refreshCookie 
                    },
                    "mode":"cors",
                    "redirect": 'manual'
                }
            );
            if(response.status === 302) {
                let raw = response.headers.raw();
                let redirectURL = url.parse(raw["location"][0], true);
                if(redirectURL.query["access_token"] === undefined) 
                    throw new Error("No access_token in response " + raw["location"]);
                refreshCookie = raw['set-cookie'][0];
                return redirectURL.query["access_token"];
            }
            else {
                throw new Error("Redirect expected!");
            }
        } catch(err) {
            throw new NestedError("Error getting site JWT: ", err);
        }
    }

    const getSiteJWT = async () => {
        if(process.env.SITE_JWT) return Promise.resolve(process.env.SITE_JWT);

        // Get a new site JWT every 12 hours
        let need_new_site_jwt
            = jwts["site"] == undefined
            || jwts["site"].token == undefined
            || jwts["site"].time == undefined
            || Date.now() > jwts["site"].time + 1000 * 60 * 60 * 12;

        if(need_new_site_jwt) {
            console.log("Refreshing site JWT");
            jwts["site"] = {
                "token": getSiteJWTInner(),
                "time": Date.now()
            };
            
        } 
        try{
            return await jwts["site"].token;
        } catch (err) {
            delete jwts["site"];
            throw new NestedError("Error getting site JWT: ", err);
        }
    };

    const fetchFromAPI = (api, path, token, method, body) => {
        console.log(`Calling ${dablUrl + api + ledgerSegment + path} with ${JSON.stringify(body)}`);
        return callAPI(
            dablUrl + api + ledgerSegment + path,
            token,
            method,
            body
        );
    }

    const getTokenInner = async party => {
        try {
            const jwt = await getSiteJWT();
            const response = await fetchFromAPI(
                "api/ledger",
                `party/${party}/token`,
                jwt,
                "POST",
                {for: 86400}
            );
            const json = await response.json();
            return json["access_token"];
        } catch(err) {
                throw new NestedError("Error getting JWT for" + party + ": ", err);
        }
    }

    const getToken = async party => {
        // Get a new Token every 12 hours
        let need_new_party_jwt
            = jwts[party] == undefined
            || jwts[party].token == undefined
            || jwts[party].time == undefined
            || Date.now() > jwts[party].time + 1000 * 60 * 60 * 12;
    
        if(need_new_party_jwt) {
            console.log("Getting token for party ", party);
                jwts[party] = {
                    "token": getTokenInner(party),
                    "time": Date.now()
                };
        }
        try {
            return await jwts[party].token;
        } catch (err) {
            delete jwts[party];
            throw new NestedError("Error getting JWT for " + party + ": ", err);
        }
    };

    const adminToken = () => getToken(adminParty);

    const createUser = async user => {
        try {
            console.log("Creating user");
            const jwt = await getSiteJWT();
            const response = await fetchFromAPI(
                    "api/ledger",
                    "parties",
                    jwt,
                    "POST",
                    {
                        "partyName": user
                    }
                )
            if(!response.ok) {
                const body = await response.text();
                throw new Error(`Error creating user: ${response.status} ${response.statusText} ${body}`);
            }
        } catch(err) {
            throw new NestedError("Error creating user: ", err);
        }
    }

    const getApp = async () => {
        try {
            const jwt = await adminToken();
            if(appCid == null) appCid = getOrCreateApp(dataURL, adminParty, jwt);
            return appCid;
        } catch (err) {
            throw new Error("Error getting app", err);
        }
    }

    const partyTemplate = {
        "moduleName": "DABL.Ledger.V2",
        "entityName": "LedgerParty"
    };

    const getDABLUser = async user => {
        let party_ = null;

        const userPartyInner = async () => {
            try {
                const [app, adminJwt] = await Promise.all([getApp(), adminToken()]);
                const createCb = async () => {
                    try {
                        await createUser(user);
                        const response = await search(
                            dataURL,
                            adminJwt,
                            partyTemplate,
                            userParty => userParty.argument.partyName == user
                        );
                        return response[0];
                    } catch (err) {
                        throw new NestedError(`Failed to create party for user ${user}: `, err);
                    }
                }
                const contract = await getOrCreateContract(
                    app,
                    adminJwt,
                    partyTemplate,
                    userParty => userParty.argument.partyName == user,
                    createCb
                );
                return contract.argument.party;
            } catch(err) {
                throw new NestedError(`Failed to get the party for ${user}: `, err);
            }
        }

        const userParty = async () => {
            if(party_ == null) {
                console.log("Getting user party for " + user);
                party_ = userPartyInner();
            }
            return party_;
        }
    
        const userToken = async () => {
            try {
                const party = await userParty();
                return getToken(party);
            } catch (err) {
                throw new NestedError(`Error getting user token for ${user}: `, err);
            }
        }

        try {
            const [app, party, partyJwt, adminJwt] = await Promise.all([getApp(), userParty(), userToken(), adminToken()]);
            return getUser(app, user, party, partyJwt, adminParty, adminJwt);
        } catch(err) {
            throw new NestedError(`Failed to get user ${user}: `, err);
        }
    };

    const getOrCreateDablUserProfile = async (user, profile) => {
        try {
            const app = await getApp();
            return getOrCreateUserProfile(dataURL, app.version, user, profile);
        } catch (err) {
            throw new NestedError(`Failed to get or create DABL user profile for ${user}: `, err);
            
        }
    }

    return {
        adminToken,
        getUser: getDABLUser,
        getUserProfile : user => getUserProfile(dataURL, user),
        getOrCreateUserProfile : getOrCreateDablUserProfile
    }
}

export default dabl;
