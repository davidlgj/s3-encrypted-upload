#!/usr/bin/env node
const crypto = require('crypto')
const aws = require('aws-sdk')
const fs = require('fs')
const yargs = require('yargs').demandCommand(2)
                             .usage('Usage: $0 <command> <filepath> [options]')
                             .command('upload', 'Encrypt and upload file to S3')
                             .command('decrypt', 'Decrypt file')
                             .boolean('v')
                             .alias('v', 'verbose')
                             .describe('v', 'Be less cryptic')
                             .alias('p', 'passphrase')
                             .describe('p', 'The passphrase to use for encryption/decryption')
                             .nargs('p', 1)
                             .help('h')
                             .alias('h', 'help')

const argv = yargs.argv
const algorithm = 'aes-256-ctr'
const password = argv.p || process.env.PASSPHRASE

if (!password) {
  yargs.showHelp()
  process.exit(1)
}

const log = (...args) => {
  if (argv.v) {
    console.log(...args)
  }
}

// Options is set with environment variables
const config = {
  bucket: process.env.S3_BUCKET_NAME || 'davidlgjbackup',
  region: process.env.AWS_REGION || 'eu-west-1',
}
log(config)

aws.config.update(config)
const s3 = new aws.S3({ params: { Bucket: config.bucket } })


// AES256 encrypt
const encrypt = (buffer) => {
  log('Encrypting file')
  const cipher = crypto.createCipher(algorithm, password)
  const crypted = Buffer.concat([cipher.update(buffer), cipher.final()])
  return crypted
}

const decrypt = (buffer) => {
  log('Decrypting file')
  const decipher = crypto.createDecipher(algorithm, password)
  const dec = Buffer.concat([decipher.update(buffer), decipher.final()])
  return dec
}


// Hash encrypted file
const hashBuffer = (buffer) => {
  log('Hashing file')
  // Create  a sha1 hash so we can use it as a key
  const shasum = crypto.createHash('sha1')
  return shasum.update(buffer).digest('hex')
}


// Check existance and integrity
const checkIfNotUploaded = Key => new Promise((resolve, reject) => s3.headObject(
  { Key },
  (err) => {
    // Exit on other error.
    // If uploaded we should reject, so we want a 404
    if (err && err.statusCode === 404) {
      log('Image was not uploaded previously')
      resolve()
    } else if (err) {
      log('An unexpected error occured with headObject: ', err)
      reject(err)
    } else {
      log('Found file on S3')
      reject('Already uploaded.')
    }
  }
))


// Upload
const upload = (Key, Body) => {
  log('Starting upload of ', Key)
  return new Promise((resolve, reject) => {
    s3.putObject(
      { Key, Body },
      (err, data) => {
        if (err) {
          log('Upload failed', err)
          reject(err)
        } else {
          log('Upload done')
          resolve(data)
        }
      }
    )
  })
}


// Simple synchrounos operation. No need to be special for a oneoff upload.
if (argv._[0] === 'decrypt') {
  log('Decrypting file')
  const encrypted = fs.readFileSync(argv._[1])
  const decrypted = decrypt(encrypted)
  fs.writeFileSync(argv._[1].slice(0, argv._[1].lastIndexOf('.')), decrypted)
  process.exit()
}

if (argv._[0] !== 'upload') {
  yargs.showHelp()
  process.exit(1)
}

// Read file, hash it, create key and check if the upload exists.
// If not, upload.
const filepath = argv._[1]
const buffer = fs.readFileSync(filepath)
const encrypted = encrypt(buffer)
const hash = hashBuffer(encrypted)
const key = `${filepath}.${hash}`

checkIfNotUploaded(key)
.then(() => upload(key, encrypted))
.then(() => console.log(key))
.catch((err) => {
  console.error('An error occured:')
  console.error(err)
  process.exit(1)
})
