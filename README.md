# Tggl javascript client

## Usage
Add the client to your dependencies:
```
npm i tggl-client
```

Instantiate the client:
```typescript
import { TgglClient } from 'tggl-client'

const client = new TgglClient('YOUR_API_KEY')
```

Set the context on which flags evaluation should be performed:
```typescript
await client.setContext({
  userId: 'foo',
  email: 'foo@gmail.com',
  browser: 'Firefox',
  // ...
})
```
You can specify any key you want, just make sure they match the conditions you specify during flags setup.

`setContext` should be called anytime the context changes: app starts, user logs in, user changes email...
Flags evaluation is done here so you should `await` for it to finish before testing flags.

You can test if a flag is active or not:
```typescript
if (client.isActive('my-feature')) {
  // ...
}
```

Because flags evaluation is done when you call `setContext`, checking if a flag is active is
synchronous and extremely fast.

An inactive flag and a non-existing flag will both return false. This is by design and prevents anyone from breaking your
app by just deleting a flag, it will simply be considered inactive.

You can get the value of a flag:
```typescript
if (client.get('my-feature') === 'Variation A') {
  // ...
}
```

If a flag is inactive, it will always return `undefined`, otherwise it will return the value of the bucket the context falls in.
You can specify a default value for innactive flags:

```typescript
if (client.get('my-feature', 'Variation A') === 'Variation A') {
  // ...
}
```
