const path = require('path')
const matter = require('gray-matter')
const glob = require('glob')
const stringifyObject = require('stringify-object')
const { getOptions } = require('loader-utils')
const { extendFrontMatter, normalizeToUnixPath } = require('./util')

// Loads markdown files with front matter and renders them into a layout.
// Layout can be set using the `layout` key in the front matter, and will map
// to a file name in the pages/layouts directory.
module.exports = async function mdxEnhancedLoader(src) {
  const callback = this.async()
  const options = getOptions(this)

  // Parse the front matter
  let content, data
  try {
    const res = matter(src, { safeLoad: true, filename: this.resourcePath })
    content = res.content
    data = res.data
  } catch (err) {
    callback(err)
  }
  // Scan for plugin `scan` option to return results based on RegEx patterns provided in config
  const scans = scanContent(options, content)
  // Get file path relative to project root
  const resourcePath = normalizeToUnixPath(this.resourcePath)
    .replace(
      normalizeToUnixPath(
        path.join(normalizeToUnixPath(this.rootContext), 'pages')
      ),
      ''
    )
    .substring(1)

  // Checks if there's a layout, if there is, resolve the layout and wrap the content in it.
  processLayout
    .call(this, options, data, content, resourcePath, scans)
    .then(result => callback(null, result))
    .catch(err => callback(err))
}
function scanContent(options, content) {
  const { mdxEnhancedPluginOptions: pluginOpts } = options
  if (!pluginOpts.scan) return {}
  return Object.keys(pluginOpts.scan).reduce((acc, opt) => {
    // Put the result of the pattern match onto the `scans` object: `{ key : result }`
    if (content.match(pluginOpts.scan[opt].pattern)) {
      acc[opt] =
        // Check to see if a `transform` function & it is a function
        pluginOpts.scan[opt].transform &&
        typeof pluginOpts.scan[opt].transform === 'function'
          ? pluginOpts.scan[opt].transform(
              content.match(pluginOpts.scan[opt].pattern)
            )
          : content.match(opt.pattern) // Otherwise pass the raw Array of matches as the result for this key. More info here: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match#Return_value
    }
    return acc
  }, {})
}
function processLayout(options, frontMatter, content, resourcePath, scans) {
  const { mdxEnhancedPluginOptions: pluginOpts } = options

  return new Promise(async (resolve, reject) => {
    // If no layout is provided and the default layout setting is not on, return the
    // content directly.
    if (!frontMatter.layout && !pluginOpts.defaultLayout)
      return resolve(content)

    // Set the default if the option is active and there's no layout
    if (!frontMatter.layout && pluginOpts.defaultLayout) {
      frontMatter.layout = 'index'
    }

    // Layouts default to resolving from "<root>/layouts", but this is configurable.
    // If the frontMatter doesn't have a layout and defaultLayout is true, try to
    // resolve the index file within the layouts path.
    const layoutPath = path.resolve(
      options.dir,
      pluginOpts.layoutPath,
      frontMatter.layout
    )

    // If the layout doesn't exist, throw a descriptive error
    // We use glob to check for existence, since the file could have multiple page
    // extensions depending on the config
    const layoutMatcher = `${layoutPath}.+(${options.config.pageExtensions.join(
      '|'
    )})`

    const extendedFm = await extendFrontMatter({
      content,
      phase: 'loader',
      extendFm: pluginOpts.extendFrontMatter
    })

    glob(layoutMatcher, (err, matches) => {
      if (err) return reject(err)
      if (!matches.length) {
        throw new Error(
          `File "${resourcePath}" specified "${frontMatter.layout}" as its layout, but no matching file was found at "${layoutMatcher}"`
        )
      }

      const { onContent } = pluginOpts
      if (onContent && this._compiler.name === 'server') {
        onContent({
          ...frontMatter,
          ...extendedFm,
          ...{ __resourcePath: resourcePath },
          content
        })
      }

      // Import the layout, export the layout-wrapped content, pass front matter into layout
      return resolve(`import layout from '${normalizeToUnixPath(matches[0])}'
      
export default layout(${stringifyObject({
        ...frontMatter,
        ...extendedFm,
        ...{ __resourcePath: resourcePath },
        ...{ __scans: scans }
      })})

${content}
`)
    })
  })
}
