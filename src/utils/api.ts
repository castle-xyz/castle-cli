import Axios from 'axios';
import * as config from './config';

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
