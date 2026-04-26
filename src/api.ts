import Axios from 'axios';
import { getToken } from './config.js';

const API_HOST = 'https://api.castle.xyz/graphql';

const USER_FIELDS = `
  userId
  username
  token
  isAnonymous
  photo {
    url
    avatarUrl
  }
  photoFrame {
    frameUrl
  }
`;

async function API(query: string, variables: any = {}) {
  const headers: any = {
    'X-OS': 'cli',
    'X-CLI-API-Version': '4',
    'X-Scene-Creator-Version': 'latest',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const token = getToken();
  if (token) {
    headers['X-Auth-Token'] = token;
  }

  const response = await Axios.post(API_HOST, { query, variables }, {
    headers,
    maxContentLength: 100_000_000,
    maxBodyLength: 1_000_000_000,
  });
  return response.data;
}

function handleAPIError(response: any) {
  if (response.error) {
    throw new Error(response.error.message);
  }
  if (response.errors) {
    throw new Error(response.errors[0].message);
  }
}

export async function me() {
  try {
    const response = await API(`query { me { ${USER_FIELDS} } }`);
    handleAPIError(response);
    return response.data.me;
  } catch {
    return null;
  }
}

export async function startCLILogin() {
  const response = await API(`mutation { startCLILogin { pollToken url } }`);
  handleAPIError(response);
  return response.data.startCLILogin;
}

export async function pollForCLILogin(pollToken: string) {
  const response = await API(
    `query($pollToken: String!) { pollForCLILogin(pollToken: $pollToken) { ${USER_FIELDS} } }`,
    { pollToken }
  );
  handleAPIError(response);
  return response.data.pollForCLILogin;
}

export async function deck(deckId: string) {
  const response = await API(
    `query($deckId: ID!) {
      deck(deckId: $deckId) {
        deckId
        title
        visibility
        variables
        initialCard {
          cardId
          title
          sceneDataUrl
          backgroundColor
          backgroundImage {
            url
            smallUrl
            largeCardUrl
          }
        }
        cards {
          cardId
          title
          sceneDataUrl
          backgroundColor
          backgroundImage {
            url
            smallUrl
            largeCardUrl
          }
        }
      }
    }`,
    { deckId }
  );
  handleAPIError(response);
  return response.data.deck;
}

export async function downloadSceneData(sceneDataUrl: string) {
  const response = await Axios.get(sceneDataUrl, { timeout: 30_000 });
  return response.data;
}

export async function createSceneDataUploadConfig(cardIds: string[]) {
  const response = await API(
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
}

export async function updateCardAndDeckV2(deck: any, card: any) {
  const response = await API(
    `mutation($deck: DeckInput!, $card: CardInput!) {
      updateCardAndDeckV2(deck: $deck, card: $card) {
        deck {
          deckId
          visibility
        }
        card {
          cardId
        }
      }
    }`,
    { deck, card }
  );
  handleAPIError(response);
  return response.data.updateCardAndDeckV2;
}
