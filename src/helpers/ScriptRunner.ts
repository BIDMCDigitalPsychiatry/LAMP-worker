import _Docker from "dockerode"
import tar from "tar-stream"
import Stream from "stream"

let Docker:_Docker
try {
  

if (!!process.env.DOCKER_ADDR 
  && !!process.env.DOCKER_ADDR?.split(":")[0]
  && !!process.env.DOCKER_ADDR?.split(":")[1])
   Docker = new _Docker({
    host: `${process.env.DOCKER_ADDR?.split(":")[0]}`,
    port: `${process.env.DOCKER_ADDR?.split(":")[1]}`,
  })
else
 Docker = new _Docker({ socketPath: "/var/run/docker.sock"})
} catch (error) {
  console.log("Error configuring docker",error)
} 
const base_image = `node:16.8.0-alpine3.13`
export abstract class ScriptRunner {
  public abstract execute(script: string, driver_script: string|undefined, trigger:string, data?: any | undefined): Promise<void>

  /** Run JS script inside the container
   * @param string script
   * @param string driver_script
   * @param string trigger
   * @param string data
   */
  public static JS = class extends ScriptRunner {
    async execute(script: string, driver_script: string, trigger:string, data?: any | undefined): Promise<any> {
      const exists = await Docker.listImages({ filters: { reference: [base_image] } })
      if (exists.length === 0) {
        console.log("Creating docker image...")
        const image = await Docker.pull(base_image, {})
        await new Promise((resolve, reject) => {
          image.pipe(process.stdout)
          image.on("end", resolve)
          image.on("error", reject)
        })
      }
      //Create node Container
      const container = await Docker.createContainer({
        Image: base_image,
        Tty: true,
        Cmd: ["/bin/sh"],
      })
      console.log("Created the container with ID", container.id)
      await container.start()
      console.log("started the container with ID", container.id)
      const logs: Buffer[] = []
      try {
        //copy zip file to working directory
        await container.putArchive(
          makeTar({
            "/src/index.js": `
            const fs = require("fs")       
            let buff =  Buffer.from("${script}", "base64")
            fs.writeFileSync("/src/script.zip", buff)         
          `,
          }),
          { path: "/" }
        )
        //unzip files inside working directory
        logs.push(
          await containerExec(
            container,
            `cd src/ && node index.js && rm -r index.js && unzip script.zip &&  npm init -y`,
            "js"
          )
        )
        //identify requirements/dependencies if exist after unzipping
        const output = (
          await getFileInTar(await container.getArchive({ path: "/src/requirements.txt" }), "/src/requirements.txt")
        ).toString("utf8") as any

        //run the driver script after installing requirements/dependencies(if exists)
        if (!!output)
          logs.push(
            await containerExec(
              container,
              `cd src/ && npm install ${output} && node ${!!driver_script ? driver_script:"main.js"} ${!!data ? data : undefined} ${trigger}`,
              "js"
            )
          )
        else logs.push(await containerExec(container, `cd src/  
        &&  node ${!!driver_script ? driver_script:"main.js"} ${!!data ? data : undefined} ${trigger}`, "js"))
        console.log(`Script execution finished.`)
      } catch (e) {
        console.error(e)
      } finally {
        await container.stop()
        await container.remove({ force: true })
        console.log("Stopped the container")
      }
    }
  }

  /** Run PY script inside the container
   *@param string script
   *@param string driver_script
   *@param string trigger
   *@param string data
   */
  public static PY = class extends ScriptRunner {
    async execute(script: string, driver_script: string, trigger:string, data?: any | undefined): Promise<void> {
      // Build a new image with an inline Dockerfile unless one already exists.
      const exists = await Docker.listImages({ filters: { reference: [base_image] } })
      if (exists.length === 0) {
        console.log("Creating docker image...")
        const image = await Docker.pull(base_image, {})
        await new Promise((resolve, reject) => {
          image.pipe(process.stdout)
          image.on("end", resolve)
          image.on("error", reject)
        })
      }
      //Create node Container
      const container = await Docker.createContainer({
        Image: base_image,
        Tty: true,
        Cmd: ["/bin/sh"],
      })
      console.log("Created the container with ID", container.id)
      await container.start()
      console.log("started the container with ID", container.id)
      const logs: Buffer[] = []
      try {
        //copy zip file to working directory
        await container.putArchive(
          makeTar({
            "/src/index.js": `
            const fs = require("fs")       
            let buff =  Buffer.from("${script}", "base64")
            fs.writeFileSync("/src/script.zip", buff)         
          `,
          }),
          { path: "/" }
        )
        //unzip files inside working directory
        logs.push(
          await containerExec(
            container,
            `cd src/ && node index.js && rm -r index.js && unzip script.zip`,
            "js"
          )
        )
        //identify requirements/dependencies if exist after unzipping
        const output = (
          await getFileInTar(await container.getArchive({ path: "/src/requirements.txt" }), "/src/requirements.txt")
        ).toString("utf8") as any
        
        //run the driver script after installing requirements/dependencies(if exists)
        if (!!output)
          logs.push(
            await containerExec(
              container,
              `cd src/ && apk update && apk add python3 && 
              apk add py3-pip && pip3 install -r requirements.txt && python3 ${!!driver_script ? driver_script:"main.py"} ${!!data ? data : undefined} ${trigger}`,
              "py"
            )
          )
        else logs.push(await containerExec(container, `cd src/  &&
        apk update && apk add python3 &&  python3 ${!!driver_script ? driver_script:"main.py"} ${!!data ? data : undefined} ${trigger}`, "py"))
        console.log(`Script execution finished.`)
      } catch (error) {
        console.error(error)
      } finally {
        await container.stop()
        await container.remove({ force: true })
        console.log("Stopped the container")
      }
    }
  }
}
/** execute the command to be run inside the container
 *
 * @param string container
 * @param string shellCommand
 * @param string language
 */
const containerExec = (container: _Docker.Container, shellCommand: string, language: string): Promise<Buffer> => {
  let options = {}
  if (language === "js") {
    options = { Cmd: ["/bin/sh", "-c", shellCommand], AttachStdout: true, AttachStderr: true }
  } else if (language === "py") {
    options = { Cmd: ["/bin/sh", "-c", shellCommand], AttachStdout: true, AttachStderr: true }
  }
  return new Promise((resolve, error) => {
    container.exec(options, (cErr: any, exec: any) => {
      if (cErr) {
        return error(cErr)
      }
      exec.start({ hijack: true }, (sErr: any, stream: Stream) => {
        if (sErr) {
          return error(sErr)
        }
        const output: Buffer[] = []
        stream.on("data", (chunk: Buffer) => {
          chunk = chunk.slice(8)
          output.push(chunk)
        })
        stream.on("end", () => {
          resolve(Buffer.concat(output))
        })
      })
    })
  })
}

/** make tar format for script files
 *@param object data
 *@param string dirPrefix
 */
const makeTar = (data: { [filename: string]: any }, dirPrefix = ""): tar.Pack => {
  const pack = tar.pack()
  for (const x of Object.entries(data))
    pack.entry({ name: dirPrefix + x[0] }, typeof x[1] === "string" ? x[1] : JSON.stringify(x[1]))
  pack.finalize()
  return pack
}

/** execute the command to be run inside the container
 *
 * @param string container
 * @param string shellCommand
 * @param string language
 */
async function runExec(container: _Docker.Container, shellCommand: string, language: string): Promise<any> {
  //Prepare options to be applied in container instance
  let options = {}
  if (language === "js") {
    console.log("js script is being handled")
    options = {
      Cmd: ["bash", "-c", shellCommand],
      AttachStdout: true,
      AttachStderr: true,
    }
  } else if (language === "py") {
    console.log("py script is being handled")
    options = {
      Cmd: ["bash", "-c", shellCommand],
      AttachStdout: true,
      AttachStderr: true,
    }
  }
  //execute the commands
  container.exec(options, function (err: any, exec: any) {
    if (err) {
      return
    }
    exec.start(function (err: any, stream: any) {
      if (err) return
      exec.inspect(function (err: any, data: any) {
        if (err) return

        console.log(`stopping the container with ID ${container.id} in 120 seconds`)
        removeContainer(container.id)
      })
    })
  })
}
/** stop the container with a certain time out
 *
 * @param STRING containerID
 */
async function removeContainer(containerID: string): Promise<void> {
  setTimeout(async function () {
    const container = await Docker.getContainer(containerID)
    await container.stop()
    await container.remove()
    console.log("stopped and removed the container with ID", containerID)
  }, 200000)
}

/**
 *
 */
const getFileInTar = async (tarStream: NodeJS.ReadableStream, filename: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const extract = tar.extract()
    const data: Buffer[] = []
    extract.on("entry", (header, stream, next) => {
      if (header.name !== filename) next()
      stream.on("data", (chunk: Buffer) => data.push(chunk))
      stream.on("end", next)
      stream.resume()
    })
    extract.on("finish", () => resolve(Buffer.concat(data)))
    tarStream.pipe(extract)
  })
}
