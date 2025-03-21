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
  let response = await API(
    `query {
      me {
        ${USER_FIELDS}
      }
    }`
  );

  handleAPIError(response);

  return response.data.me;
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

export const updateCardAndDeckV2 = async (card, deck) => {
  let response = await API(
    `mutation($card: CardInput!, $deck: DeckInput!, $isAutosave: Boolean) {
      updateCardAndDeckV2(card: $card, deck: $deck, isAutosave: $isAutosave) {
        card {
          cardId
        }
        deck {
          deckId
        }
      }
    }`,
    { card, deck, isAutosave: false }
  );

  handleAPIError(response);

  return response.data.updateCardAndDeckV2;
};
