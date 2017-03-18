const chai = require('chai')
const expect = chai.expect
const path = require('path')
const logger = require('hw-logger')
//const log = logger.log
const helper = require('../lib/helper')

describe('helper', () => {

  before(() => {
    logger.setLevel('trace')
  })

  it('should convert to id', () => {
    const id = helper.toId('Any title with (special characters) $ * "and accéèentsçàôù" :')
    expect(id).to.equal('any-title-with-special-characters-and-acceeentscaou')
  })

  it('should find repo', () => {
    const name = 'repo1'
    const repos = [{name, value: 'value1'}, {name: 'repo2', value: 'value2'}]
    const repo = helper.findRepo(name, repos)
    expect(repo).to.eql(repos[0])
  })

  it('should find repo', () => {
    const repoName = helper.getRepoName('reponame/subdir/subsubdir/file')
    expect(repoName).to.equal('reponame')
  })

  it('should build breadcrumb', () => {
    const repoName = helper.buildBreadcrumb('reponame/subdir/subsubdir/file')
    expect(repoName).to.eql([
      {
        title: 'subdir',
        url: 'subdir'
      }, {
        title: 'subsubdir',
        url: 'subdir/subsubdir'
      }, {
        title: 'file',
        url: 'subdir/subsubdir/file'
      }
    ])
  })

  it('should execute command', () => {
    const text = 'Hello!'
    return helper.executeCmd(`echo "${text}"`)
      .then(result => {
        expect(result).to.have.property('stdout', `${text}\n`)
      })
      .then(() => helper.executeCmd(`>&2 echo "${text}"`))
      .then(result => {
        expect(result).to.have.property('stderr', `${text}\n`)
      })
  })

  it('should scan files', () => {
    const config = require('../lib/default-config')
    const mdExtPattern = config['markdownExt'].join('|')
    const include = new RegExp(`\.(${mdExtPattern})$`)
    return helper
      .scanMdFiles({
        baseDir: path.join(__dirname, 'src'),
        excludeDir: config['excludeDir'], include
      })
      .then(result => {
        const expectedResult = ['doc1/readme.md',
          'markdown-samples/sample-1.md',
          'markdown-samples/sample-10.md',
          'markdown-samples/sample-11.md',
          'markdown-samples/sample-12.md',
          'markdown-samples/sample-2.md',
          'markdown-samples/sample-3.md',
          'markdown-samples/sample-4.md',
          'markdown-samples/sample-5.md',
          'markdown-samples/sample-6.md',
          'markdown-samples/sample-7.md',
          'markdown-samples/sample-8.md',
          'markdown-samples/sample-9.md'
        ]
        expect(result).to.eql(expectedResult)
      })
  })

})
