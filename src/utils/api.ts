import Axios from 'axios';
import * as config from './config.js';

const DEBUG = false;

const API_HOST = DEBUG ? 'http://localhost:1380/graphql' : 'https://api.castle.xyz/graphql';

const USER_FIELDS = `
  userId
  username
  token
`;

async function API(query, variables = {}) {
  let headers = {
    'X-OS': 'cli',
    'X-CLI-API-Version': '2',
    'X-Scene-Creator-Version': 'latest',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  let token = config.getToken();
  if (token) {
    headers['X-Auth-Token'] = token;
  }

  let response = await Axios.post(
    API_HOST,
    {
      query,
      variables,
    },
    {
      headers,
      maxContentLength: 100000000,
      maxBodyLength: 1000000000,
    }
  );

  return response.data;
}

function handleAPIError(response) {
  if (response.error) {
    let err: any = new Error(response.error.message);
    err.extensions = response.error.extensions;
    throw err;
  }

  if (response.errors) {
    let err: any = new Error(response.errors[0].message);
    err.extensions = response.errors[0].extensions;
    throw err;
  }
}

export const me = async () => {
  try {
    let response = await API(
      `query {
      me {
        ${USER_FIELDS}
      }
    }`
    );

    handleAPIError(response);

    return response.data.me;
  } catch (e) {
    return null;
  }
};

export const startCLILogin = async () => {
  let response = await API(
    `mutation {
      startCLILogin {
        pollToken
        url
      }
    }`
  );

  handleAPIError(response);

  return response.data.startCLILogin;
};

export const pollForCLILogin = async (pollToken) => {
  let response = await API(
    `query($pollToken: String!) {
      pollForCLILogin(pollToken: $pollToken) {
        ${USER_FIELDS}
      }
    }`,
    { pollToken }
  );

  handleAPIError(response);

  return response.data.pollForCLILogin;
};

export const logout = async () => {
  let response = await API(
    `mutation {
      logout
    }`
  );

  handleAPIError(response);

  return response.data.logout;
};

export const deck = async (deckId) => {
  let response = await API(
    `query($deckId: ID!) {
      deck(deckId: $deckId) {
        deckId
        initialCard {
          cardId
        }
        cards {
          cardId
          sceneDataUrl
        }
      }
    }`,
    { deckId }
  );

  handleAPIError(response);

  return response.data.deck;
};

export const createSceneDataUploadConfig = async (cardIds) => {
  let response = await API(
    `mutation($cardIds: [ID!]!) {
      createSceneDataUploadConfig(cardIds: $cardIds) {
        cardId
        uploadId
        postUrl
        postFields
      }
    }`,
    { cardIds }
  );

  handleAPIError(response);

  return response.data.createSceneDataUploadConfig;
};

export const uploadSceneData = async (cards) => {
  let response = await API(
    `mutation($cards: [CardSceneDataInput!]!, $isAutosave: Boolean) {
      uploadSceneData(cards: $cards, isAutosave: $isAutosave) {
        cardId
        sceneDataUrl
      }
    }`,
    { cards, isAutosave: false }
  );

  handleAPIError(response);

  return response.data.uploadSceneData;
};

export const resolveDeepLink = async (url) => {
  let response = await API(
    `query($url: String!) {
      resolveDeepLink(url: $url) {
        deck {
          deckId
        }
      }
    }`,
    { url }
  );

  handleAPIError(response);

  return response.data.resolveDeepLink;
};
