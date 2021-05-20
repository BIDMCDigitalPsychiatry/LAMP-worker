import _Docker from "dockerode"
import tar from "tar-stream"
import Stream from "stream"
const Docker = new _Docker({
  host: `${process.env.DOCKER_ADDR?.split(":")[0]}`,
  port: `${process.env.DOCKER_ADDR?.split(":")[1]}`,
})
// const Docker = new _Docker({ socketPath: "//./pipe/docker_engine" })

export abstract class ScriptRunner {
  public abstract execute(script: string, requirements: string, version?: string, data?: any | undefined): Promise<void>

  /** Run JS script inside the container
   * @param string script
   * @param string requirements
   * @param string version
   * @param string data
   */
  public static JS = class extends ScriptRunner {
    async execute(script: string, requirements: string, version?: string, data?: any | undefined): Promise<any> {
      const exists = await Docker.listImages({ filters: { reference: [`${process.env.DOCKER_IMAGE}`] } })
      if (exists.length === 0) {
        console.log("Creating docker image...")
        const image = await Docker.pull(`${process.env.DOCKER_IMAGE}`, {})
        await new Promise((resolve, reject) => {
          image.pipe(process.stdout)
          image.on("end", resolve)
          image.on("error", reject)
        })
      }
      console.log("Creating docker container...")
      const container = await Docker.createContainer({
        Image: `${process.env.DOCKER_IMAGE}`,
        Tty: true,
        Cmd: ["/bin/bash"],
      })
      console.log("Created the container with ID", container.id)
      await container.start()
      console.log("started the container with ID", container.id)
      try {
        await container.putArchive(
          makeTar({
            "/usr/script": script,
          }),
          { path: "/" }
        )
        const logs: Buffer[] = []
        //If requirements are present
        if (requirements && requirements.split(",").length > 0) {
          const requirements_ = `${requirements
            .split(",")
            .map((x) => x.trim())
            .join(" ")}`
          console.log("Installing packages...and running the script")
          logs.push(
            await containerExec(
              container,
              `touch /usr/stdout && chmod +x /usr/script &&  npm init -y  && npm install ${requirements_} && 
          node /usr/script ${!!data ? data : ""}`,
              "js"
            )
          )
        } else {
          console.log("Running the script without any packages")
          logs.push(
            await containerExec(container, `touch /usr/stdout && chmod +x /usr/script &&  node /usr/script`, "js")
          )
        }
        const output = (await getFileInTar(await container.getArchive({ path: "/usr/stdout" }), "stdout")).toString(
          "utf8"
        ) as any

        if (!!output) console.log(`output retrieved from script - ${output} `)
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
   *@param string requirements
   *@param string version
   *@param string data
   */
  public static PY = class extends ScriptRunner {
    async execute(script: string, requirements: string, version?: string, data?: any | undefined): Promise<void> {
      // Build a new image with an inline Dockerfile unless one already exists.
      const exists = await Docker.listImages({ filters: { reference: [`${process.env.DOCKER_IMAGE}`] } })
      if (exists.length === 0) {
        console.log("Creating docker image...")
        const image = await Docker.pull(`${process.env.DOCKER_IMAGE}`, {})
        await new Promise((resolve, reject) => {
          image.pipe(process.stdout)
          image.on("end", resolve)
          image.on("error", reject)
        })
      }
      console.log("Creating docker container...")
      const container = await Docker.createContainer({
        Image: `${process.env.DOCKER_IMAGE}`,
        Tty: true,
        Cmd: ["/bin/bash"],
      })
      console.log("Created the container with ID", container.id)
      await container.start()
      console.log("started the container with ID", container.id)
      const logs: Buffer[] = []
      try {
        await container.putArchive(
          makeTar({
            "/usr/script": script,
          }),
          { path: "/" }
        )
        let pyVersion = "python3"
        if (version?.toLowerCase() === "python2") pyVersion = "python2"
        //If requirements are present
        if (requirements && requirements.split(",").length > 0) {
          let pipVersion = "pip3"
          if (version?.toLowerCase() === "python2") pipVersion = "pip2"
          const requirements_ = `${requirements
            .split(",")
            .map((x) => x.trim())
            .join(" ")}`
          console.log("Installing packages...and running the script")
          logs.push(
            await containerExec(
              container,
              `touch /usr/stdout && chmod +x /usr/script &&  ${pipVersion} install ${requirements_} && 
          ${pyVersion} /usr/script ${!!data ? data : ""}`,
              "py"
            )
          )
        } else {
          console.log("Running script without packages")
          logs.push(
            await containerExec(
              container,
              `touch /usr/stdout && chmod +x /usr/script && 
          ${pyVersion} /usr/script ${!!data ? data : ""}`,
              "py"
            )
          )
        }
        const output = (await getFileInTar(await container.getArchive({ path: "/usr/stdout" }), "stdout")).toString(
          "utf8"
        ) as any
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
    console.log("js script is being handled")
    options = { Cmd: ["/bin/sh", "-c", shellCommand], AttachStdout: true, AttachStderr: true }
  } else if (language === "py") {
    console.log("py script is being handled")
    options = { Cmd: ["/bin/sh", "-c", shellCommand], AttachStdout: true, AttachStderr: true }
  }
  return new Promise((resolve, error) => {
    container.exec(options, (cErr: any, exec: any) => {
      if (cErr) return error(cErr)
      exec.start({ hijack: true }, (sErr: any, stream: Stream) => {
        if (sErr) return error(sErr)
        const output: Buffer[] = []
        stream.on("data", (chunk: Buffer) => {
          chunk = chunk.slice(8)
          console.log(chunk.toString("utf8"))
          output.push(chunk)
        })
        stream.on("end", () => {
          console.log("Ended the stream")
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
