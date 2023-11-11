const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const { gmail } = require('googleapis/build/src/apis/gmail');
const { create } = require('domain');


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.labels', 'https://www.googleapis.com/auth/gmail.modify'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.

// Get the token and credentials path 
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
let gm;
let labelName = 'replied';
/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */

async function loadSavedCredentialsIfExist() { // To load saved credentials
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) { // To save credentials
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */

async function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.list({
        userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
        console.log('No labels found.');
        return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
        console.log(`- ${label.name}`);
    });
}



/**
 *  Retrieves the list of email for authenticated users
 * @param {Object} auth 
 * @returns {Array}
 */
async function getListOfMessages(auth) {
    const res = await gm.users.messages.list({ userId: 'me', maxResults: 1 }); // maxResults sets the limit 
    return res.data.messages || [];
}

/**
 * 
 * @param {string} labelName 
 * @returns {string}
 */
async function createOrGetLabel(labelName) {
    const response = await gm.users.labels.list({ userId: "me", });
    const label = response.data.labels.find((label) => label.name === labelName);
    let newLabel;
    if (label) {
        return label;
    }

    const newLabelDetails = {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
    }
    try {
        newLabel = await gm.users.labels.create({ userId: 'me', resource: newLabelDetails });
        // console.log('Label created:', createdLabel.data);
    } catch (error) {
        console.err('Error creating label');
    }

    return newLabel;
}

/**
 * 
 * @param {string} messageId 
 *  Function sends replies to the email that have no prior replies and add the message to replies label 
 */
async function sendReply(messageId) {
    const message = await gm.users.messages.get({ userId: 'me', id: messageId });
    const label = await createOrGetLabel(labelName);
    const hasReplied = message.data.payload.headers.some((header) => header.name === "In-Reply-To");
    const receiverEmail = message.data.payload.headers.find(header => header.name === 'From').value;

    
    if (!hasReplied && receiverEmail !== 'dhruvilprajapati2003@gmail.com') {
        const threadId = message.data.threadId;
        const originalMessageId = message.data.payload.headers.find(header => header.name === 'Message-ID').value;
        const originalMessageBody = Buffer.from(message.data.payload.parts[0].body.data, 'base64').toString();


        const replyMessage = {
            userId: "me",
            resource: {
                threadId: threadId,
                raw: Buffer.from(
                    `To: ${message.data.payload.headers.find(
                        (header) => header.name === "From"
                    ).value
                    }\r\n` +
                    `Subject: Re: ${message.data.payload.headers.find(
                        (header) => header.name === "Subject"
                    ).value
                    }\r\n` +
                    `In-Reply-To: ${originalMessageId}\r\n` +
                    `References: ${originalMessageId}\r\n` +
                    `Content-Type: text/plain; charset="UTF-8"\r\n` +
                    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                    `-- ${originalMessageBody}\r\n\r\n` +
                    `This reply is automated. Please do not reply back!'.\r\n`
                ).toString("base64"),
            },
        };
        try {
            await gm.users.messages.send(replyMessage);

            if (label && label.id) {
                await gm.users.messages.modify({
                    userId: 'me',
                    id: messageId,
                    resource: {
                        addLabelIds: [label.id],
                        removeLabelIds: ["INBOX"],
                    },
                });
            }
            console.log('Successfully sent to ' + receiverEmail);
        } catch (error) {
            console.error(error);
        }
    }

}

/**
 *  Main execution of the app
 * @param {OAuth2Client} auth
 *  
 */
async function mainExecution(auth, randomInterval) {
    gm = google.gmail({ version: 'v1', auth });
    try {
        const listMessages = await getListOfMessages(auth);
        for (const message of listMessages) {
            await sendReply(message.id);
        }
    } catch (error) {
        console.error(error);
    }
    console.log(`Waiting for ${randomInterval / 1000} seconds ...`);
}

/**
 *  Execution every 45-120 seconds
 * @param {*} auth 
 */
async function executeWithRandomInterval(auth) {
    let randomInterval = Math.floor(Math.random() * (120000 - 45000 + 1)) + 45000;
    await mainExecution(auth,randomInterval)
    setInterval(async () => {
        try {
            randomInterval = Math.floor(Math.random() * (120000 - 45000 + 1)) + 45000;
            await mainExecution(auth, randomInterval);
        } catch (error) {
            console.error(error);
        }
    }, randomInterval);
}

authorize().then(auth => executeWithRandomInterval(auth)).catch(console.error);

