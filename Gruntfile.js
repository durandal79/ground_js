module.exports = function (grunt) {

  grunt.loadNpmTasks('grunt-ts')
  grunt.loadNpmTasks('grunt-contrib-concat')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.loadNpmTasks('grunt-text-replace')

  grunt.initConfig({
    ts: {
      ground: {                                 // a particular target
        src: ["lib/export.ts"],        // The source typescript files, http://gruntjs.com/configuring-tasks#files
        out: 'ground.js',                // If specified, generate an out.js file which is the merged js file
//        outDir: 'js',    // If specified, the generate javascript files are placed here. Only works if out is not specified
        options: {                    // use to override the default options, http://gruntjs.com/configuring-tasks#options
          target: 'es5',            // 'es3' (default) | 'es5'
          module: 'commonjs',       // 'amd' (default) | 'commonjs'
          sourcemap: true,          // true  (default) | false
          declaration: true,       // true | false  (default)
          verbose: true
        }
      }
    },
    concat: {
      options: {
        separator: ''
      },
      ground: {
        src: ['ground_header.js', 'ground.js'],
        dest: 'ground.js'
      },
      "ground-def": {
        src: [
          'ground.d.ts',
          'lib/ground_definition_footer'
        ],
        dest: 'ground.d.ts'
      }
    },
    replace: {
      "ground-def": {
        src: ["ground.d.ts"],
        overwrite: true,
        replacements: [
          {
            from: 'defs/',
            to: ""
          },
          {
            from: '/// <reference path="mysql.d.ts" />',
            to: ""
          },
          {
            from: '/// <reference path="node.d.ts" />',
            to: ""
          }
        ]
      }
    },
    watch: {
      ground: {
        files: 'lib/**/*.ts',
        tasks: ['default']
      }
    }
  })

  grunt.registerTask('default', ['ts:ground', 'concat:ground', 'concat:ground-def', 'replace:ground-def']);

}