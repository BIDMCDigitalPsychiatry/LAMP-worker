require("dotenv").config()
import express, { Application, Router, Request, Response } from "express"
import cors from "cors"
import fileUpload from "express-fileupload"
import fs from "fs"
import { connect, NatsConnectionOptions, Payload } from "ts-nats"
import nano from "nano"
import _Docker from "dockerode"
import AdmZip from "adm-zip"
import { ScriptRunner } from "./helpers/ScriptRunner"
import { MongoClient } from "mongodb"
import { NotificationScheduling, cleanAllQueues, updateSchedule } from "./queue/ActivitySchedulerJob"
import { initializeQueues } from "./queue/Queue"
import { Mutex } from "async-mutex"
import ioredis from "ioredis"
import LAMP from "lamp-core"
import morgan from "morgan"
const clientLock = new Mutex()
const app: Application = express()
const UploadPath = __dirname + "/uploads/"

//enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
)
app.set("json spaces", 2)
app.use(express.json({ limit: "50mb", strict: false }))
app.use(express.text())
app.use(cors())
app.use(morgan(":method :url :status - :response-time ms"))
app.use(express.urlencoded({ extended: true }))
const _server = app
let DB_DRIVER = ""
let MongoClientDB: any
let Database: any
let RedisClient: ioredis.Redis | undefined

//consumer topics
const topics = [
  "activity_event",
  "participant.*.activity_event",
  "activity.*.activity_event",
  "participant.*.activity.*.activity_event",
  "activity",
  "study.*.activity",
  "activity.*",
  "participant",
  "study.*.participant",
  "participant.*",
  "researcher.*",
  "researcher",
  "sensor_event",
  "participant.*.sensor_event",
  "sensor.*.sensor_event",
  "participant.*.sensor.*.sensor_event",
  "sensor",
  "sensor.*",
  "study.*.sensor",
  "study.*",
  "researcher.*.study",
  "study",
]

//INTERFACES
interface ScriptPaths {
  _id?: string
  paths: string[]
}
interface SubscribeOutput {
  identifier?: string
  token?: string
  subscribed: boolean
}

/**Initialize and configure the application.
 *
 */
async function main(): Promise<void> {
  //Identifying the Database driver -- IF the DB in env starts with mongodb://, create mongodb connection
  //--ELSEIF the DB/CDB in env starts with http or https, create couch db connection
  if (process.env.DB?.startsWith("mongodb://")) {
    DB_DRIVER = "mongodb"
    await Bootstrap()
  } else if (process.env.DB?.startsWith("http") || process.env.DB?.startsWith("https")) {
    DB_DRIVER = "couchdb"
    await Bootstrap()
  } else {
    if (process.env.CDB?.startsWith("http") || process.env.CDB?.startsWith("https")) {
      DB_DRIVER = "couchdb"
      await Bootstrap()
    } else {
      console.log(`Missing repository adapter.`)
      throw new Error("Missing repository adapter")
    }
  }
}

/**
 * bootstrapping lamp-worker
 */
async function Bootstrap(): Promise<void> {
  if (DB_DRIVER === "mongodb") {
    try {
      //Connect to mongoDB
      const client = new MongoClient(`${process.env.DB}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      })

      await client.connect()
      if (client.isConnected()) {
        const db = process.env.DB?.split("/").reverse()[0]?.split("?")[0]
        MongoClientDB = await client?.db(db)
        if (!!MongoClientDB) {
          console.log("MONGODB adapter in use.")
          const DBs = await MongoClientDB.listCollections().toArray()
          const dbs: string[] = []
          for (const db of DBs) {
            await dbs.push(db.name)
          }
          if (!dbs.includes("scriptpaths")) {
            console.log("Initializing Scriptpaths database...")
            await MongoClientDB.createCollection("scriptpaths")
          }
          console.log("Scriptpaths database online.")
        }
      } else {
        console.log("Database connection failed.")
        throw new Error("Database connection failed")
      }
    } catch (error) {
      console.log("Database connection failed.")
      throw new Error("Database connection failed")
    }
  } else {
    try {
      Database =
        process.env.DB?.startsWith("http") || process.env.DB?.startsWith("https")
          ? await nano(process.env.DB ?? "")
          : process.env.CDB?.startsWith("http") || process.env.CDB?.startsWith("https")
          ? await nano(process.env.CDB ?? "")
          : ""
      const _db_list = await Database.db.list()
      if (!_db_list.includes("scriptpaths")) {
        console.log("Initializing Scriptpaths database...")
        await Database.db.create("scriptpaths")
      }
      console.log("Scriptpaths database online.")
      console.log(`COUCHDB adapter in use `)
    } catch (error) {
      console.log("Database connection failed.")
      throw new Error("Database connection failed")
    }
  }

  if (typeof process.env.REDIS_HOST === "string") {
    await initializeQueues()
    RedisClient = new ioredis(  
      parseInt(`${(process.env.REDIS_HOST as any).match(/([0-9]+)/g)?.[0]}`),
      process.env.REDIS_HOST.match(/\/\/([0-9a-zA-Z._]+)/g)?.[0]
    )
  }
  await ServerConnect()
  if (process.env.SCHEDULER === "on") {
    console.log("Clean all queues...")
    await cleanAllQueues()
    console.log("Initializing schedulers...")
    NotificationScheduling()
  } else {
    console.log("Running with schedulers disabled.")
  }
}
/**
 * Initializing LAMP_SERVER connection
 */
async function ServerConnect(): Promise<void> {
  try {
    const server_url = `${process.env.LAMP_SERVER}`
    const accessKey = process.env.LAMP_AUTH?.split(":")[0] as string
    const secretKey = process.env.LAMP_AUTH?.split(":")[1] as string
    await LAMP.connect({ accessKey: accessKey, secretKey: secretKey, serverAddress: server_url })
  } catch (error) {}
}

/**API-save consumer token with script-Only Zip Uploads Are Allowed
 * zip file usually includes script file, requirements.txt(if any), version.txt(if in case of python, need to identify whether the version is pyhon3 or python2)
 * @param STRING token
 * @param FILE scriptfile
 * @return JSON SubscribeOutput
 */
app.post("/consumer/subscribe", async (req: Request, res: Response) => {
  try {
    if (!req.files) throw new Error("No files were selected")
    if (!req.body.token) throw new Error("No token was specified")
    const scriptFile = req.files?.scriptfile as any
    const extension = scriptFile?.name.split(".").pop()?.toLowerCase()
    if ("zip" !== extension) throw new Error("Only zip upload is allowed")
    const identifier = Math.floor(Math.random() * 10000) + 1 + new Date().getTime()
    const token: string = req.body.token
    const fileName = identifier + "_" + scriptFile?.name
    const uploadPath = UploadPath + fileName

    //MOVE SCRIPT FILE TO DIRECTORY
    scriptFile.mv(uploadPath, async (err: any) => {
      if (err) res.status(400).json("No scripts were uploaded")
      //find paths for the token
      const data = await _select(token)
      //if data exists, update the paths for the token
      if (!!data && data.length !== 0) {
        await _update(token, fileName)
      } else {
        //if no data exists, insert the paths for the new token
        await _insert({ _id: token, paths: [fileName] })
        try {
          await RedisClient?.rpush("tokens:subscribed", [JSON.stringify(token)])
        } catch (error) {
          console.log(error)
        }
      }
    })
    const output: SubscribeOutput = {
      identifier: fileName?.split(".")[0],
      token: token,
      subscribed: true,
    }
    res.send(output)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**API-delete the script associated with a token
 * @param STRING token
 * @param STRING identifier
 * @return JSON
 */
app.post("/consumer/unsubscribe", async (req: Request, res: Response) => {
  try {
    if (!req.body.token) throw new Error("No token was specified")
    if (!req.body.identifier) throw new Error("No identifier was specified")
    const token: string = req.body.token
    const identifier: string = req.body.identifier
    const scriptpaths = await _select(token)
    let paths = scriptpaths[0].paths
    const ignoredPathIndex = paths.indexOf(identifier + ".zip")
    if (ignoredPathIndex > -1) {
      await paths.splice(ignoredPathIndex, 1)
      await _updatepaths(token, paths)
      try {
        const unlinkPath = UploadPath + identifier + ".zip"
        await fs.unlinkSync(unlinkPath)
      } catch (error) {}
    }
    const output: SubscribeOutput = { token: token, subscribed: false, identifier: identifier }
    res.send(output)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**FIND SCRIPT PATHS FOR A TOKEN
 *
 * @param STRING token
 * @returns ScriptPaths all_res
 */
const _select = async (token: string): Promise<ScriptPaths[]> => {
  let all_res
  if (DB_DRIVER === "couchdb") {
    try {
      all_res = (await Database.use("scriptpaths").find({ selector: { _id: token } })).docs.map((x: any) => ({
        ...x,
        _id: undefined,
        _rev: undefined,
      })) as any
    } catch (error) {}
  } else {
    const data = await MongoClientDB.collection("scriptpaths").find({ _id: token }).maxTimeMS(60000).toArray()
    all_res = (data as any).map((x: any) => ({
      ...x,
      _id: undefined,
    }))
  }
  return all_res
}
/**save scripth path for a token
 * @param ScriptPaths object
 * @returns  {}
 */
const _insert = async (object: ScriptPaths): Promise<{}> => {
  try {
    if (DB_DRIVER === "couchdb") {
      await Database.use("scriptpaths").insert({
        _id: object._id,
        paths: object.paths,
      } as any)
    } else {
      await MongoClientDB.collection("scriptpaths").insertOne({
        _id: object._id,
        paths: object.paths,
      } as any)
    }
    return {}
  } catch (error) {
    throw new Error("500.insert-failed")
  }
}

/**INSERT SCRIPT FOR AN EXISTING TOKEN(APPEND THE uploadPath string IN EXISTING PATH ARRAY)
 *
 * @param STRING token
 * @param STRING uploadPath
 * @returns {}
 */
const _update = async (token: string, uploadPath: string): Promise<{}> => {
  try {
    if (DB_DRIVER === "couchdb") {
      const orig: any = await Database.use("scriptpaths").get(token)
      await Database.use("scriptpaths").bulk({ docs: [{ ...orig, paths: [...orig.paths, uploadPath] }] })
    } else {
      const orig: any = await MongoClientDB.collection("scriptpaths").findOne({ _id: token })
      await MongoClientDB.collection("scriptpaths").updateOne(
        { _id: token },
        { $set: { paths: [...orig.paths, uploadPath] } }
      )
    }
    return {}
  } catch (error) {
    throw new Error("500.update-failed")
  }
}

/**DELETE THE RECORD FOR A TOKEN
 *
 * @param STRING token
 * @returns {}
 */
const _delete = async (token: string): Promise<{}> => {
  try {
    if (DB_DRIVER === "couchdb") {
      try {
        const orig: any = await Database.use("scriptpaths").get(token)
        const data = await Database.use("scriptpaths").bulk({
          docs: [{ ...orig, _deleted: true }],
        })
      } catch (e) {}
    } else {
      try {
        const orig: any = await MongoClientDB.collection("scriptpaths").findOne({ _id: token })
        await MongoClientDB.collection("scriptpaths").deleteOne({ _id: token })
      } catch (e) {}
    }
    return {}
  } catch (error) {
    throw new Error("500.delete-failed")
  }
}

/**UPDATE SCRIPT ARRAY FOR A TOKEN
 *
 * @param STRING token
 * @param ARRAY uploadPath
 * @returns {}
 */
const _updatepaths = async (token: string, uploadPath: string[]): Promise<{}> => {
  try {
    if (DB_DRIVER === "couchdb") {
      const orig: any = await Database.use("scriptpaths").get(token)
      await Database.use("scriptpaths").bulk({ docs: [{ ...orig, paths: uploadPath }] })
    } else {
      const orig: any = await MongoClientDB.collection("scriptpaths").findOne({ _id: token })
      await MongoClientDB.collection("scriptpaths").updateOne({ _id: token }, { $set: { paths: uploadPath } })
    }
    return {}
  } catch (error) {
    throw new Error("500.update-failed")
  }
}

/**Get related tokens(eg: a.id1.b.aid1 will gives a.*.b.aid1,a.id1.b.*,a.*.b.* )
 *
 * @param token
 * @returns ARRAY related_tokens
 */
const getRelatedTokens = async (token: string): Promise<string[]> => {
  try {
    let related_tokens: string[] = []
    const arr = token.split(".")
    if (arr.length === 2) {
      related_tokens.push(arr[0] + ".*", token)
    } else if (arr.length === 4) {
      related_tokens.push(
        arr[0] + ".*" + "." + arr[2] + ".*",
        arr[0] + ".*." + arr[2] + "." + arr[3],
        arr[0] + "." + arr[1] + "." + arr[2] + ".*",
        token
      )
    }
    return related_tokens
  } catch (error) {
    return []
  }
}

/** extract the zip and run the script inside the container
 * @param array paths
 * @param string data
 */
const execScript = async (paths: string[], data?: any): Promise<void> => {
  for (const path of paths) {
    const realPath = UploadPath + path
    let zip = new AdmZip(realPath)
    let zipEntries = zip.getEntries() // an array of ZipEntry records
    let extension
    let version = "" //to store version if any
    let script = "" //to store script
    let requirements = "" //to store requirements(or packages) if any

    for (const zipEntry of zipEntries) {
      if (zipEntry.entryName === "requirements.txt") {
        requirements = zipEntry.getData().toString("utf8")
      } else if (zipEntry.entryName === "version.txt") {
        version = zipEntry.getData().toString("utf8")
      } else {
        extension = zipEntry.entryName.split(".").pop()?.toLowerCase()
        script = zipEntry.getData().toString("utf8")
      }
    }
    let runner: ScriptRunner
    switch (extension) {
      case "js":
        runner = new ScriptRunner.JS()
        runner.execute(script, requirements, version, data)
        break

      case "py":
        runner = new ScriptRunner.PY()
        runner.execute(script, requirements, version, data)
        break

      default:
        break
    }
  }
}

main()
  .then((x: any) => {
    //Initiate Nats server
    console.log("Initiating nats server")
    try {
      connect({
        servers: [`${process.env.NATS_SERVER}`],
        payload: Payload.JSON,
      }).then((x) =>
        topics.map((topic: any) => {
          x.subscribe(topic, async (err, msg) => {
            const data = msg.data
            updateSchedule(topic, data.data)
            const related_tokens = await getRelatedTokens(data.token)
            for (const related_token of related_tokens) {
              const release = await clientLock.acquire()
              try {
                const Store_Size = (await RedisClient?.llen("tokens:subscribed")) as number
                let shouldQuery = false
                if (Store_Size != 0) {
                  const Store_Data = (await RedisClient?.lrange("tokens:subscribed", 0, Store_Size)) as []
                  for (const store_data of Store_Data) {
                    if (related_token === JSON.parse(store_data)) {
                      shouldQuery = true
                      break
                    }
                  }
                }
                //get paths of token given
                const scriptpaths = shouldQuery ? await _select(related_token) : []
                const paths = scriptpaths.length !== 0 ? scriptpaths[0].paths : []
                if (paths.length !== 0) {
                  console.log(`Executing the script uploaded for the token,${related_token}`)
                  //execute the script retrieved for the token
                  await execScript(paths, JSON.stringify(data.data))
                } else console.log(`Not subscribed for ${related_token}`)
                release()
                console.log("released the lock")
              } catch (error) {
                console.log("released on exception")
                release()
              }
            }
          })
        })
      )
      //Starting the server
      _server.listen(process.env.PORT || 3000)
    } catch (error) {
      // tslint:disable-next-line:no-console
      console.log(error)
    }
  })
  .catch(console.error)
