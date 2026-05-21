import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

const ID_TOKEN_KEY = "idToken";
const ACCESS_TOKEN_KEY = "accessToken";

const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
};

export const userPool = new CognitoUserPool(poolData);

export function loginWithCognito(email, password) {
  const user = new CognitoUser({
    Username: email,
    Pool: userPool,
  });

  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const idToken = session.getIdToken().getJwtToken();
        const accessToken = session.getAccessToken().getJwtToken();

        localStorage.setItem(ID_TOKEN_KEY, idToken);
        localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);

        resolve({ idToken, accessToken });
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
}

export function getStoredIdToken() {
  return localStorage.getItem(ID_TOKEN_KEY);
}

export function logout() {
  const currentUser = userPool.getCurrentUser();
  if (currentUser) currentUser.signOut();

  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}
