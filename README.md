# axios-refresh-auth

[![NPM Version](https://img.shields.io/npm/v/axios-refresh-auth)
](https://www.npmjs.com/package/axios-refresh-auth)
![NPM License](https://img.shields.io/npm/l/axios-refresh-auth)
[![codecov](https://codecov.io/gh/yikenman/axios-refresh-auth/graph/badge.svg?token=43EG2T8LKS)](https://codecov.io/gh/yikenman/axios-refresh-auth)

`axios-refresh-auth` is an Axios interceptor that provides a robust and intuitive mechanism for handling token refresh with concurrency safety.

---

## Features

- ✅ Handles concurrency scenarios.
- ✅ Intuitive retry flow — requests either trigger a refresh or wait for an ongoing refresh to complete.
- ✅ Multi-instance support with shared refresh and retry.
- ✅ Fully end-to-end tested.

## Install

```bash
$ npm install --save axios-refresh-auth axios
```

## Usage

```ts
import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { createInterceptorRegister } from 'axios-refresh-auth';

const instance = axios.create();

/**
 * @param error AxiosError - axios error from origin request. 
 * @param refreshInstance AxiosInstance - a wrapped origin axios instance with default config: `{ skipAuthRefresh: true }`.
 * @return any
 */
const refreshAuthCall = async (error, refreshInstance) => {
  const res = await refreshInstance.post('http://example.com/api/refresh');

  localStorage.setItem('token', res.data.token);
  // update token to the instance
  refreshInstance.defaults.headers['Authorization'] = 'Bearer ' + res.data.token;
  return;
};

// create the interceptor register
const register = createInterceptorRegister(refreshAuthCall, {
  onRetry: (config) => {
    // apply new token in the retry
    config.headers['Authorization'] = 'Bearer ' + localStorage.getItem('token');
    return config;
  }
});

const unregister = register(instance);

// Any 401 error (by default) will trigger refresh and retry the request.
instance.get('http://example.com/api/protected').then(/* ... */).catch(/* ... */);
```

## API

### createInterceptorRegister(refreshAuthCall, options)

Creates a `register` function that can register request/response interceptors on an Axios instance. The `register` function will return an `unregister` function to remove the above interceptors.

```ts
const instance = axios.create();

// create register function.
const register = createInterceptorRegister(refreshAuthCall);

// Interceptors had been registered.
const unregister = register(instance);

// Interceptors had been removed from instance.
unregister()
```

#### refreshAuthCall

The main refresh logic will be triggered when a request matches the refresh condition (`statusCodes`/`shouldRefresh`).

> Noted: If you want to use origin instance to perform request, use refreshInstance instead or use config: `{ skipAuthRefresh: true }`.

e.g.:

```ts
const instance = axios.create();

const refreshAuthCall = async (error, refreshInstance) => {
  // use refreshInstance
  const res = await refreshInstance.post('http://example.com/api/refresh');
  // or
  // const res = await instance.post('http://example.com/api/refresh', { skipAuthRefresh: true });

  localStorage.setItem('token', res.data.token);
  refreshInstance.config.headers['Authorization'] = 'Bearer ' + ress.data.token;
  return;
};

// create the interceptor register
const register = createInterceptorRegister(refreshAuthCall);
```

#### options (Optional)

| Option                  | Type                                                                  | Default     | Description                                                                                                                |
| ----------------------- | --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `statusCodes`           | `number \| string \| Array<number \| string>`                         | `[401]`     | Status codes that should trigger a refresh. Ignored if `shouldRefresh` is provided. |
| `shouldRefresh`         | `(error: AxiosError) => boolean`                                      | `undefined` | Custom logic to determine whether a refresh should be triggered. If set, `statusCodes` will be ignored. |
| `retryInstance`         | `AxiosInstance`                                                       | `undefined` | Axios instance used for retrying failed requests. If not provided, the same instance is used.                              |
| `interceptNetworkError` | `boolean`                                                             | `false`     | Whether network errors (e.g. no response) should also trigger refresh logic.                              |
| `onRetry`               | `<T extends AxiosRequestConfig>(requestConfig: T) => T \| Promise<T>` | `undefined` | Hook to adjust the request config before retrying (e.g. re-apply tokens, modify headers).                                  |
| `maxRefreshTimes`       | `number`                                                              | `1`         | Prevents infinite loops. Defines the maximum number of times a single request can trigger a refresh. Minimum value is `1`. |

### Skip refresh

Using skipAuthRefresh in the request config will skip refresh process:

```ts
instance.post('http://example.com/api/skip-refresh', { skipAuthRefresh: true });
```

## Refresh across instances

`axios-refresh-auth` supports sharing refresh process across multiple Axios instances.

e.g.:

```ts
const instance1 = axios.create();
const instance2 = axios.create();

const register = createInterceptorRegister(/* ... */);

const unregister1 = register(instance1);
const unregister2 = register(instance2);

// refresh triggered by instance1 will also affect instance2.
instance1.get('http://example.com/api/protected').then(/* ... */).catch(/* ... */);
```

## Migrate from `axios-auth-refresh`

`axios-refresh-auth` is fully compatible with `axios-auth-refresh`, while providing additional features such as concurrency safety, multi-instance support, and easier testing.

## Covered scenarios

Below diagram shows all scenarios that had been covered:

```
Time ──>
A: ──────────> [Request] ─X─> [Refresh Start] ──────────────> [Refresh End] ────> [Retry]
B: ────────────────────────────────────────────> [Request] ─────────────────────> [Retry]
C: ──────────────────────────────────────────────X──────────────────────────────> [Retry]
D: [Request] ─────────────────────────────────────────────────────────────────X─> [Retry]
```

Marks:

- X: Request failure or triggers refresh.
- [Refresh Start] / [Refresh End]: Token refresh process.
- Retry: Request is retried after the refresh completes.

Requests:

- A: Main timeline request.
- B: Request sent while A’s refresh is in progress, waits for refresh.
- C: Request fails during A’s refresh, queued until refresh finishes.
- D: Request sent before A, fails after A’s refresh, retried with the new token.

## License

MIT License