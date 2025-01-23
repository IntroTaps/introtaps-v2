ataCache.get(this);

		if (cache.ignores) {
			return cache.ignores;
		}

		// otherwise calculate it

		const result = [];

		for (const config of this) {
			/*
			 * We only count ignores if there are no other keys in the object.
			 * In this case, it acts list a globally ignored pattern. If there
			 * are additional keys, then ignores act like exclusions.
			 */
			if (
				config.ignores &&
				Object.keys(config).filter(key => !META_FIELDS.has(key))
					.length === 1
			) {
				result.push(...config.ignores);
			}
		}

		// store result
		cache.ignores = result;
		dataCache.set(this, cache);

		return result;
	}

	/**
	 * Indicates if the config array has been normalized.
	 * @returns {boolean} True if the config array is normalized, false if not.
	 */
	isNormalized() {
		return this[ConfigArraySymbol.isNormalized];
	}

	/**
	 * Normalizes a config array by flattening embedded arrays and executing
	 * config functions.
	 * @param {Object} [context] The context object for config functions.
	 * @returns {Promise<ConfigArray>} The current ConfigArray instance.
	 */
	async normalize(context = {}) {
		if (!this.isNormalized()) {
			const normalizedConfigs = await normalize(
				this,
				context,
				this.extraConfigTypes,
			);
			this.length = 0;
			this.push(
				...normalizedConfigs.map(
					this[ConfigArraySymbol.preprocessConfig].bind(this),
				),
			);
			this.forEach(assertValidBaseConfig);
			this[ConfigArraySymbol.isNormalized] = true;

			// prevent further changes
			Object.freeze(this);
		}

		return this;
	}

	/**
	 * Normalizes a config array by flattening embedded arrays and executing
	 * config functions.
	 * @param {Object} [context] The context object for config functions.
	 * @returns {ConfigArray} The current ConfigArray instance.
	 */
	normalizeSync(context = {}) {
		if (!this.isNormalized()) {
			const normalizedConfigs = normalizeSync(
				this,
				context,
				this.extraConfigTypes,
			);
			this.length = 0;
			this.push(
				...normalizedConfigs.map(
					this[ConfigArraySymbol.preprocessConfig].bind(this),
				),
			);
			this.forEach(assertValidBaseConfig);
			this[ConfigArraySymbol.isNormalized] = true;

			// prevent further changes
			Object.freeze(this);
		}

		return this;
	}

	/* eslint-disable class-methods-use-this -- Desired as instance methods */

	/**
	 * Finalizes the state of a config before being cached and returned by
	 * `getConfig()`. Does nothing by default but is provided to be
	 * overridden by subclasses as necessary.
	 * @param {Object} config The config to finalize.
	 * @returns {Object} The finalized config.
	 */
	[ConfigArraySymbol.finalizeConfig](config) {
		return config;
	}

	/**
	 * Preprocesses a config during the normalization process. This is the
	 * method to override if you want to convert an array item before it is
	 * validated for the first time. For example, if you want to replace a
	 * string with an object, this is the method to override.
	 * @param {Object} config The config to preprocess.
	 * @returns {Object} The config to use in place of the argument.
	 */
	[ConfigArraySymbol.preprocessConfig](config) {
		return config;
	}

	/* eslint-enable class-methods-use-this -- Desired as instance methods */

	/**
	 * Returns the config object for a given file path and a status that can be used to determine why a file has no config.
	 * @param {string} filePath The path of a file to get a config for.
	 * @returns {{ config?: Object, status: "ignored"|"external"|"unconfigured"|"matched" }}
	 * An object with an optional property `config` and property `status`.
	 * `config` is the config object for the specified file as returned by {@linkcode ConfigArray.getConfig},
	 * `status` a is one of the constants returned by {@linkcode ConfigArray.getConfigStatus}.
	 */
	getConfigWithStatus(filePath) {
		assertNormalized(this);

		const cache = this[ConfigArraySymbol.configCache];

		// first check the cache for a filename match to avoid duplicate work
		if (cache.has(filePath)) {
			return cache.get(filePath);
		}

		// check to see if the file is outside the base path

		const relativeFilePath = toRelativePath(
			filePath,
			this.#namespacedBasePath,
			this.#path,
		);

		if (EXTERNAL_PATH_REGEX.test(relativeFilePath)) {
			debug(`No config for file ${filePath} outside of base path`);

			// cache and return result
			cache.set(filePath, CONFIG_WITH_STATUS_EXTERNAL);
			return CONFIG_WITH_STATUS_EXTERNAL;
		}

		// next check to see if the file should be ignored

		// check if this should be ignored due to its directory
		if (this.isDirectoryIgnored(this.#path.dirname(filePath))) {
			debug(`Ignoring ${filePath} based on directory pattern`);

			// cache and return result
			cache.set(filePath, CONFIG_WITH_STATUS_IGNORED);
			return CONFIG_WITH_STATUS_IGNORED;
		}

		if (shouldIgnorePath(this.ignores, filePath, relativeFilePath)) {
			debug(`Ignoring ${filePath} based on file pattern`);

			// cache and return result
			cache.set(filePath, CONFIG_WITH_STATUS_IGNORED);
			return CONFIG_WITH_STATUS_IGNORED;
		}

		// filePath isn't automatically ignored, so try to construct config

		const matchingConfigIndices = [];
		let matchFound = false;
		const universalPattern = /^\*$|\/\*{1,2}$/u;

		this.forEach((config, index) => {
			if (!config.files) {
				if (!config.ignores) {
					debug(`Universal config found for ${filePath}`);
					matchingConfigIndices.push(index);
					return;
				}

				if (pathMatchesIgnores(filePath, relativeFilePath, config)) {
					debug(
						`Matching config found for ${filePath} (based on ignores: ${config.ignores})`,
					);
					matchingConfigIndices.push(index);
					return;
				}

				debug(
					`Skipped config found for ${filePath} (based on ignores: ${config.ignores})`,
				);
				return;
			}

			/*
			 * If a config has a files pattern * or patterns ending in /** or /*,
			 * and the filePath only matches those patterns, then the config is only
			 * applied if there is another config where the filePath matches
			 * a file with a specific extensions such as *.js.
			 */

			const universalFiles = config.files.filter(pattern =>
				universalPattern.test(pattern),
			);

			// universal patterns were found so we need to check the config twice
			if (universalFiles.length) {
				debug("Universal files patterns found. Checking carefully.");

				const nonUniversalFiles = config.files.filter(
					pattern => !universalPattern.test(pattern),
				);

				// check that the config matches without the non-universal files first
				if (
					nonUniversalFiles.length &&
					pathMatches(filePath, relativeFilePath, {
						files: nonUniversalFiles,
						ignores: config.ignores,
					})
				) {
					debug(`Matching config found for ${filePath}`);
					matchingConfigIndices.push(index);
					matchFound = true;
					return;
				}

				// if there wasn't a match then check if it matches with universal files
				if (
					universalFiles.length &&
					pathMatches(filePath, relativeFilePath, {
						files: universalFiles,
						ignores: config.ignores,
					})
				) {
					debug(`Matching config found for ${filePath}`);
					matchingConfigIndices.push(index);
					return;
				}

				// if we make here, then there was no match
				return;
			}

			// the normal case
			if (pathMatches(filePath, relativeFilePath, config)) {
				debug(`Matching config found for ${filePath}`);
				matchingConfigIndices.push(index);
				matchFound = true;
			}
		});

		// if matching both files and ignores, there will be no config to create
		if (!matchFound) {
			debug(`No matching configs found for ${filePath}`);

			// cache and return result
			cache.set(filePath, CONFIG_WITH_STATUS_UNCONFIGURED);
			return CONFIG_WITH_STATUS_UNCONFIGURED;
		}

		// check to see if there is a config cached by indices
		const indicesKey = matchingConfigIndices.toString();
		let configWithStatus = cache.get(indicesKey);

		if (configWithStatus) {
			// also store for filename for faster lookup next time
			cache.set(filePath, configWithStatus);

			return configWithStatus;
		}

		// otherwise construct the config

		// eslint-disable-next-line array-callback-return, consistent-return -- rethrowConfigError always throws an error
		let finalConfig = matchingConfigIndices.reduce((result, index) => {
			try {
				return this[ConfigArraySymbol.schema].merge(
					result,
					this[index],
				);
			} catch (validationError) {
				rethrowConfigError(this[index], index, validationError);
			}
		}, {});

		finalConfig = this[ConfigArraySymbol.finalizeConfig](finalConfig);

		configWithStatus = Object.freeze({
			config: finalConfig,
			status: "matched",
		});
		cache.set(filePath, configWithStatus);
		cache.set(indicesKey, configWithStatus);

		return configWithStatus;
	}

	/**
	 * Returns the config object for a given file path.
	 * @param {string} filePath The path of a file to get a config for.
	 * @returns {Object|undefined} The config object for this file or `undefined`.
	 */
	getConfig(filePath) {
		return this.getConfigWithStatus(filePath).config;
	}

	/**
	 * Determines whether a file has a config or why it doesn't.
	 * @param {string} filePath The path of the file to check.
	 * @returns {"ignored"|"external"|"unconfigured"|"matched"} One of the following values:
	 * * `"ignored"`: the file is ignored
	 * * `"external"`: the file is outside the base path
	 * * `"unconfigured"`: the file is not matched by any config
	 * * `"matched"`: the file has a matching config
	 */
	getConfigStatus(filePath) {
		return this.getConfigWithStatus(filePath).status;
	}

	/**
	 * Determines if the given filepath is ignored based on the configs.
	 * @param {string} filePath The path of a file to check.
	 * @returns {boolean} True if the path is ignored, false if not.
	 * @deprecated Use `isFileIgnored` instead.
	 */
	isIgnored(filePath) {
		return this.isFileIgnored(filePath);
	}

	/**
	 * Determines if the given filepath is ignored based on the configs.
	 * @param {string} filePath The path of a file to check.
	 * @returns {boolean} True if the path is ignored, false if not.
	 */
	isFileIgnored(filePath) {
		return this.getConfigStatus(filePath) === "ignored";
	}

	/**
	 * Determines if the given directory is ignored based on the configs.
	 * This checks only default `ignores` that don't have `files` in the
	 * same config. A pattern such as `/foo` be considered to ignore the directory
	 * while a pattern such as `/foo/**` is not considered to ignore the
	 * directory because it is matching files.
	 * @param {string} directoryPath The path of a directory to check.
	 * @returns {boolean} True if the directory is ignored, false if not. Will
	 * 		return true for any directory that is not inside of `basePath`.
	 * @throws {Error} When the `ConfigArray` is not normalized.
	 */
	isDirectoryIgnored(directoryPath) {
		assertNormalized(this);

		const relativeDirectoryPath = toRelativePath(
			directoryPath,
			this.#namespacedBasePath,
			this.#path,
		);

		// basePath directory can never be ignored
		if (relativeDirectoryPath === "") {
			return false;
		}

		if (EXTERNAL_PATH_REGEX.test(relativeDirectoryPath)) {
			return true;
		}

		// first check the cache
		const cache = dataCache.get(this).directoryMatches;

		if (cache.has(relativeDirectoryPath)) {
			return cache.get(relativeDirectoryPath);
		}

		const directoryParts = relativeDirectoryPath.split("/");
		let relativeDirectoryToCheck = "";
		let result;

		/*
		 * In order to get the correct gitignore-style ignores, where an
		 * ignored parent directory cannot have any descendants unignored,
		 * we need to check every directory starting at the parent all
		 * the way down to the actual requested directory.
		 *
		 * We aggressively cache all of this info to make sure we don't
		 * have to recalculate everything for every call.
		 */
		do {
			relativeDirectoryToCheck += `${directoryParts.shift()}/`;

			result = shouldIgnorePath(
				this.ignores,
				this.#path.join(this.basePath, relativeDirectoryToCheck),
				relativeDirectoryToCheck,
			);

			cache.set(relativeDirectoryToCheck, result);
		} while (!result && directoryParts.length);

		// also cache the result for the requested path
		cache.set(relativeDirectoryPath, result);

		return result;
	}
}

export { ConfigArray, ConfigArraySymbol };
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         function reportNoBeginningLinebreak(node, token) {
            context.report({
                node,
                loc: token.loc,
                messageId: "unexpectedOpeningLinebreak",
                fix(fixer) {
                    const nextToken = sourceCode.getTokenAfter(token, { includeComments: true });

                    if (astUtils.isCommentToken(nextToken)) {
                        return null;
                    }

                    return fixer.removeRange([token.range[1], nextToken.range[0]]);
                }
            });
        }

        /**
         * Reports that there shouldn't be a linebreak before the last token
         * @param {ASTNode} node The node to report in the event of an error.
         * @param {Token} token The token to use for the report.
         * @returns {void}
         */
        function reportNoEndingLinebreak(node, token) {
            context.report({
                node,
                loc: token.loc,
                messageId: "unexpectedClosingLinebreak",
                fix(fixer) {
                    const previousToken = sourceCode.getTokenBefore(token, { includeComments: true });

                    if (astUtils.isCommentToken(previousToken)) {
                        return null;
                    }

                    return fixer.removeRange([previousToken.range[1], token.range[0]]);
                }
            });
        }

        /**
         * Reports that there should be a linebreak after the first token
         * @param {ASTNode} node The node to report in the event of an error.
         * @param {Token} token The token to use for the report.
         * @returns {void}
         */
        function reportRequiredBeginningLinebreak(node, token) {
            context.report({
                node,
                loc: token.loc,
                messageId: "missingOpeningLinebreak",
                fix(fixer) {
                    return fixer.insertTextAfter(token, "\n");
                }
            });
        }

        /**
         * Reports that there should be a linebreak before the last token
         * @param {ASTNode} node The node to report in the event of an error.
         * @param {Token} token The token to use for the report.
         * @returns {void}
         */
        function reportRequiredEndingLinebreak(node, token) {
            context.report({
                node,
                loc: token.loc,
                messageId: "missingClosingLinebreak",
                fix(fixer) {
                    return fixer.insertTextBefore(token, "\n");
                }
            });
        }

        /**
         * Reports a given node if it violated this rule.
         * @param {ASTNode} node A node to check. This is an ArrayExpression node or an ArrayPattern node.
         * @returns {void}
         */
        function check(node) {
            const elements = node.elements;
            const normalizedOptions = normalizeOptions(context.options[0]);
            const options = normalizedOptions[node.type];
            const openBracket = sourceCode.getFirstToken(node);
            const closeBracket = sourceCode.getLastToken(node);
            const firstIncComment = sourceCode.getTokenAfter(openBracket, { includeComments: true });
            const lastIncComment = sourceCode.getTokenBefore(closeBracket, { includeComments: true });
            const first = sourceCode.getTokenAfter(openBracket);
            const last = sourceCode.getTokenBefore(closeBracket);

            const needsLinebreaks = (
                elements.length >= options.minItems ||
                (
                    options.multiline &&
                    elements.length > 0 &&
                    firstIncComment.loc.start.line !== lastIncComment.loc.end.line
                ) ||
                (
                    elements.length === 0 &&
                    firstIncComment.type === "Block" &&
                    firstIncComment.loc.start.line !== lastIncComment.loc.end.line &&
                    firstIncComment === lastIncComment
                ) ||
                (
                    options.consistent &&
                    openBracket.loc.end.line !== first.loc.start.line
                )
            );

            /*
             * Use tokens or comments to check multiline or not.
             * But use only tokens to check whether linebreaks are needed.
             * This allows:
             *     var arr = [ // eslint-disable-line foo
             *         'a'
             *     ]
             */

            if (needsLinebreaks) {
                if (astUtils.isTokenOnSameLine(openBracket, first)) {
                    reportRequiredBeginningLinebreak(node, openBracket);
                }
                if (astUtils.isTokenOnSameLine(last, closeBracket)) {
                    reportRequiredEndingLinebreak(node, closeBracket);
                }
            } else {
                if (!astUtils.isTokenOnSameLine(openBracket, first)) {
                    reportNoBeginningLinebreak(node, openBracket);
                }
                if (!astUtils.isTokenOnSameLine(last, closeBracket)) {
                    reportNoEndingLinebreak(node, closeBracket);
                }
            }
        }

        //----------------------------------------------------------------------
        // Public
        //----------------------------------------------------------------------

        return {
            ArrayPattern: check,
            ArrayExpression: check
        };
    }
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     figurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
  }
  Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  o[k2] = m[k];
});

export function __exportStar(m, o) {
  for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
}

export function __values(o) {
  var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
  if (m) return m.call(o);
  if (o && typeof o.length === "number") return {
      next: function () {
          if (o && i >= o.length) o = void 0;
          return { value: o && o[i++], done: !o };
      }
  };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}

export function __read(o, n) {
  var m = typeof Symbol === "function" && o[Symbol.iterator];
  if (!m) return o;
  var i = m.call(o), r, ar = [], e;
  try {
      while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
  }
  catch (error) { e = { error: error }; }
  finally {
      try {
          if (r && !r.done && (m = i["return"])) m.call(i);
      }
      finally { if (e) throw e.error; }
  }
  return ar;
}

/** @deprecated */
export function __spread() {
  for (var ar = [], i = 0; i < arguments.length; i++)
      ar = ar.concat(__read(arguments[i]));
  return ar;
}

/** @deprecated */
export function __spreadArrays() {
  for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
  for (var r = Array(s), k = 0, i = 0; i < il; i++)
      for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
          r[k] = a[j];
  return r;
}

export function __spreadArray(to, from, pack) {
  if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
      if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
      }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
}

export function __await(v) {
  return this instanceof __await ? (this.v = v, this) : new __await(v);
}

export function __asyncGenerator(thisArg, _arguments, generator) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var g = generator.apply(thisArg, _arguments || []), i, q = [];
  return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
  function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
  function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
  function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
  function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
  function fulfill(value) { resume("next", value); }
  function reject(value) { resume("throw", value); }
  function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
}

export function __asyncDelegator(o) {
  var i, p;
  return i = {}, verb("next"), verb("throw", function (e) { throw e; }), verb("return"), i[Symbol.iterator] = function () { return this; }, i;
  function verb(n, f) { i[n] = o[n] ? function (v) { return (p = !p) ? { value: __await(o[n](v)), done: false } : f ? f(v) : v; } : f; }
}

export function __asyncValues(o) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var m = o[Symbol.asyncIterator], i;
  return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
  function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
  function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
}

export function __makeTemplateObject(cooked, raw) {
  if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
  return cooked;
};

var __setModuleDefault = Object.create ? (function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
  o["default"] = v;
};

var ownKeys = function(o) {
  ownKeys = Object.getOwnPropertyNames || function (o) {
    var ar = [];
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
    return ar;
  };
  return ownKeys(o);
};

export function __importStar(mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
  __setModuleDefault(result, mod);
  return result;
}

export function __importDefault(mod) {
  return (mod && mod.__esModule) ? mod : { default: mod };
}

export function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

export function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
}

export function __classPrivateFieldIn(state, receiver) {
  if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
  return typeof state === "function" ? receiver === state : state.has(receiver);
}

export function __addDisposableResource(env, value, async) {
  if (value !== null && value !== void 0) {
    if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
    var dispose, inner;
    if (async) {
      if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
      dispose = value[Symbol.asyncDispose];
    }
    if (dispose === void 0) {
      if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
      dispose = value[Symbol.dispose];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
    if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
    env.stack.push({ value: value, dispose: dispose, async: async });
  }
  else if (async) {
    env.stack.push({ async: true });
  }
  return value;
}

var _SuppressedError = typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

export function __disposeResources(env) {
  function fail(e) {
    env.error = env.hasError ? new _SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
    env.hasError = true;
  }
  var r, s = 0;
  function next() {
    while (r = env.stack.pop()) {
      try {
        if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
        if (r.dispose) {
          var result = r.dispose.call(r.value);
          if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
        }
        else s |= 1;
      }
      catch (e) {
        fail(e);
      }
    }
    if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
    if (env.hasError) throw env.error;
  }
  return next();
}

export function __rewriteRelativeImportExtension(path, preserveJsx) {
  if (typeof path === "string" && /^\.\.?\//.test(path)) {
      return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
          return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
      });
  }
  return path;
}

export default {
  __extends,
  __assign,
  __rest,
  __decorate,
  __param,
  __esDecorate,
  __runInitializers,
  __propKey,
  __setFunctionName,
  __metadata,
  __awaiter,
  __generator,
  __createBinding,
  __exportStar,
  __values,
  __read,
  __spread,
  __spreadArrays,
  __spreadArray,
  __await,
  __asyncGenerator,
  __asyncDelegator,
  __asyncValues,
  __makeTemplateObject,
  __importStar,
  __importDefault,
  __classPrivateFieldGet,
  __classPrivateFieldSet,
  __classPrivateFieldIn,
  __addDisposableResource,
  __disposeResources,
  __rewriteRelativeImportExtension,
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                ile.
 * @param {string} filePath The path to the configuration.
 * @returns {ConfigData|null} The configuration information.
 * @private
 */
function loadConfigFile(filePath) {
    switch (path.extname(filePath)) {
        case ".js":
        case ".cjs":
            return loadJSConfigFile(filePath);

        case ".json":
            if (path.basename(filePath) === "package.json") {
                return loadPackageJSONConfigFile(filePath);
            }
            return loadJSONConfigFile(filePath);

        case ".yaml":
        case ".yml":
            return loadYAMLConfigFile(filePath);

        default:
            return loadLegacyConfigFile(filePath);
    }
}

/**
 * Write debug log.
 * @param {string} request The requested module name.
 * @param {string} relativeTo The file path to resolve the request relative to.
 * @param {string} filePath The resolved file path.
 * @returns {void}
 */
function writeDebugLogForLoading(request, relativeTo, filePath) {
    /* istanbul ignore next */
    if (debug.enabled) {
        let nameAndVersion = null;

        try {
            const packageJsonPath = ModuleResolver.resolve(
                `${request}/package.json`,
                relativeTo
            );
            const { version = "unknown" } = require(packageJsonPath);

            nameAndVersion = `${request}@${version}`;
        } catch (error) {
            debug("package.json was not found:", error.message);
            nameAndVersion = request;
        }

        debug("Loaded: %s (%s)", nameAndVersion, filePath);
    }
}

/**
 * Create a new context with default values.
 * @param {ConfigArrayFactoryInternalSlots} slots The internal slots.
 * @param {"config" | "ignore" | "implicit-processor" | undefined} providedType The type of the current configuration. Default is `"config"`.
 * @param {string | undefined} providedName The name of the current configuration. Default is the relative path from `cwd` to `filePath`.
 * @param {string | undefined} providedFilePath The path to the current configuration. Default is empty string.
 * @param {string | undefined} providedMatchBasePath The type of the current configuration. Default is the directory of `filePath` or `cwd`.
 * @returns {ConfigArrayFactoryLoadingContext} The created context.
 */
function createContext(
    { cwd, resolvePluginsRelativeTo },
    providedType,
    providedName,
    providedFilePath,
    providedMatchBasePath
) {
    const filePath = providedFilePath
        ? path.resolve(cwd, providedFilePath)
        : "";
    const matchBasePath =
        (providedMatchBasePath && path.resolve(cwd, providedMatchBasePath)) ||
        (filePath && path.dirname(filePath)) ||
        cwd;
    const name =
        providedName ||
        (filePath && path.relative(cwd, filePath)) ||
        "";
    const pluginBasePath =
        resolvePluginsRelativeTo ||
        (filePath && path.dirname(filePath)) ||
        cwd;
    const type = providedType || "config";

    return { filePath, matchBasePath, name, pluginBasePath, type };
}

/**
 * Normalize a given plugin.
 * - Ensure the object to have four properties: configs, environments, processors, and rules.
 * - Ensure the object to not have other properties.
 * @param {Plugin} plugin The plugin to normalize.
 * @returns {Plugin} The normalized plugin.
 */
function normalizePlugin(plugin) {

    // first check the cache
    let normalizedPlugin = normalizedPlugins.get(plugin);

    if (normalizedPlugin) {
        return normalizedPlugin;
    }

    normalizedPlugin = {
        configs: plugin.configs || {},
        environments: plugin.environments || {},
        processors: plugin.processors || {},
        rules: plugin.rules || {}
    };

    // save the reference for later
    normalizedPlugins.set(plugin, normalizedPlugin);

    return normalizedPlugin;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The factory of `ConfigArray` objects.
 */
class ConfigArrayFactory {

    /**
     * Initialize this instance.
     * @param {ConfigArrayFactoryOptions} [options] The map for additional plugins.
     */
    constructor({
        additionalPluginPool = new Map(),
        cwd = process.cwd(),
        resolvePluginsRelativeTo,
        builtInRules,
        resolver = ModuleResolver,
        eslintAllPath,
        getEslintAllConfig,
        eslintRecommendedPath,
        getEslintRecommendedConfig
    } = {}) {
        internalSlotsMap.set(this, {
            additionalPluginPool,
            cwd,
            resolvePluginsRelativeTo:
                resolvePluginsRelativeTo &&
                path.resolve(cwd, resolvePluginsRelativeTo),
            builtInRules,
            resolver,
            eslintAllPath,
            getEslintAllConfig,
            eslintRecommendedPath,
            getEslintRecommendedConfig
        });
    }

    /**
     * Create `ConfigArray` instance from a config data.
     * @param {ConfigData|null} configData The config data to create.
     * @param {Object} [options] The options.
     * @param {string} [options.basePath] The base path to resolve relative paths in `overrides[].files`, `overrides[].excludedFiles`, and `ignorePatterns`.
     * @param {string} [options.filePath] The path to this config data.
     * @param {string} [options.name] The config name.
     * @returns {ConfigArray} Loaded config.
     */
    create(configData, { basePath, filePath, name } = {}) {
        if (!configData) {
            return new ConfigArray();
        }

        const slots = internalSlotsMap.get(this);
        const ctx = createContext(slots, "config", name, filePath, basePath);
        const elements = this._normalizeConfigData(configData, ctx);

        return new ConfigArray(...elements);
    }

    /**
     * Load a config file.
     * @param {string} filePath The path to a config file.
     * @param {Object} [options] The options.
     * @param {string} [options.basePath] The base path to resolve relative paths in `overrides[].files`, `overrides[].excludedFiles`, and `ignorePatterns`.
     * @param {string} [options.name] The config name.
     * @returns {ConfigArray} Loaded config.
     */
    loadFile(filePath, { basePath, name } = {}) {
        const slots = internalSlotsMap.get(this);
        const ctx = createContext(slots, "config", name, filePath, basePath);

        return new ConfigArray(...this._loadConfigData(ctx));
    }

    /**
     * Load the config file on a given directory if exists.
     * @param {string} directoryPath The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.basePath] The base path to resolve relative paths in `overrides[].files`, `overrides[].excludedFiles`, and `ignorePatterns`.
     * @param {string} [options.name] The config name.
     * @returns {ConfigArray} Loaded config. An empty `ConfigArray` if any config doesn't exist.
     */
    loadInDirectory(directoryPath, { basePath, name } = {}) {
        const slots = internalSlotsMap.get(this);

        for (const filename of configFilenames) {
            const ctx = createContext(
                slots,
                "config",
                name,
                path.join(directoryPath, filename),
                basePath
            );

            if (fs.existsSync(ctx.filePath) && fs.statSync(ctx.filePath).isFile()) {
                let configData;

                try {
                    configData = loadConfigFile(ctx.filePath);
                } catch (error) {
                    if (!error || error.code !== "ESLINT_CONFIG_FIELD_NOT_FOUND") {
                        throw error;
                    }
                }

                if (configData) {
                    debug(`Config file found: ${ctx.filePath}`);
                    return new ConfigArray(
                        ...this._normalizeConfigData(configData, ctx)
                    );
                }
            }
        }

        debug(`Config file not found on ${directoryPath}`);
        return new ConfigArray();
    }

    /**
     * Check if a config file on a given directory exists or not.
     * @param {string} directoryPath The path to a directory.
     * @returns {string | null} The path to the found config file. If not found then null.
     */
    static getPathToConfigFileInDirectory(directoryPath) {
        for (const filename of configFilenames) {
            const filePath = path.join(directoryPath, filename);

            if (fs.existsSync(filePath)) {
                if (filename === "package.json") {
                    try {
                        loadPackageJSONConfigFile(filePath);
                        return filePath;
                    } catch { /* ignore */ }
                } else {
                    return filePath;
                }
            }
        }
        return null;
    }

    /**
     * Load `.eslintignore` file.
     * @param {string} filePath The path to a `.eslintignore` file to load.
     * @returns {ConfigArray} Loaded config. An empty `ConfigArray` if any config doesn't exist.
     */
    loadESLintIgnore(filePath) {
        const slots = internalSlotsMap.get(this);
        const ctx = createContext(
            slots,
            "ignore",
            void 0,
            filePath,
            slots.cwd
        );
        const ignorePatterns = loadESLintIgnoreFile(ctx.filePath);

        return new ConfigArray(
            ...this._normalizeESLintIgnoreData(ignorePatterns, ctx)
        );
    }

    /**
     * Load `.eslintignore` file in the current working directory.
     * @returns {ConfigArray} Loaded config. An empty `ConfigArray` if any config doesn't exist.
     */
    loadDefaultESLintIgnore() {
        const slots = internalSlotsMap.get(this);
        const eslintIgnorePath = path.resolve(slots.cwd, ".eslintignore");
        const packageJsonPath = path.resolve(slots.cwd, "package.json");

        if (fs.existsSync(eslintIgnorePath)) {
            return this.loadESLintIgnore(eslintIgnorePath);
        }
        if (fs.existsSync(packageJsonPath)) {
            const data = loadJSONConfigFile(packageJsonPath);

            if (Object.hasOwnProperty.call(data, "eslintIgnore")) {
                if (!Array.isArray(data.eslintIgnore)) {
                    throw new Error("Package.json eslintIgnore property requires an array of paths");
                }
                const ctx = createContext(
                    slots,
                    "ignore",
                    "eslintIgnore in package.json",
                    packageJsonPath,
                    slots.cwd
                );

                return new ConfigArray(
                    ...this._normalizeESLintIgnoreData(data.eslintIgnore, ctx)
                );
            }
        }

        return new ConfigArray();
    }

    /**
     * Load a given config file.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} Loaded config.
     * @private
     */
    _loadConfigData(ctx) {
        return this._normalizeConfigData(loadConfigFile(ctx.filePath), ctx);
    }

    /**
     * Normalize a given `.eslintignore` data to config array elements.
     * @param {string[]} ignorePatterns The patterns to ignore files.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_normalizeESLintIgnoreData(ignorePatterns, ctx) {
        const elements = this._normalizeObjectConfigData(
            { ignorePatterns },
            ctx
        );

        // Set `ignorePattern.loose` flag for backward compatibility.
        for (const element of elements) {
            if (element.ignorePattern) {
                element.ignorePattern.loose = true;
            }
            yield element;
        }
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData} configData The config data to normalize.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _normalizeConfigData(configData, ctx) {
        const validator = new ConfigValidator();

        validator.validateConfigSchema(configData, ctx.name || ctx.filePath);
        return this._normalizeObjectConfigData(configData, ctx);
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData|OverrideConfigData} configData The config data to normalize.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_normalizeObjectConfigData(configData, ctx) {
        const { files, excludedFiles, ...configBody } = configData;
        const criteria = OverrideTester.create(
            files,
            excludedFiles,
            ctx.matchBasePath
        );
        const elements = this._normalizeObjectConfigDataBody(configBody, ctx);

        // Apply the criteria to every element.
        for (const element of elements) {

            /*
             * Merge the criteria.
             * This is for the `overrides` entries that came from the
             * configurations of `overrides[].extends`.
             */
            element.criteria = OverrideTester.and(criteria, element.criteria);

            /*
             * Remove `root` property to ignore `root` settings which came from
             * `extends` in `overrides`.
             */
            if (element.criteria) {
                element.root = void 0;
            }

            yield element;
        }
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData} configData The config data to normalize.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_normalizeObjectConfigDataBody(
        {
            env,
            extends: extend,
            globals,
            ignorePatterns,
            noInlineConfig,
            parser: parserName,
            parserOptions,
            plugins: pluginList,
            processor,
            reportUnusedDisableDirectives,
            root,
            rules,
            settings,
            overrides: overrideList = []
        },
        ctx
    ) {
        const extendList = Array.isArray(extend) ? extend : [extend];
        const ignorePattern = ignorePatterns && new IgnorePattern(
            Array.isArray(ignorePatterns) ? ignorePatterns : [ignorePatterns],
            ctx.matchBasePath
        );

        // Flatten `extends`.
        for (const extendName of extendList.filter(Boolean)) {
            yield* this._loadExtends(extendName, ctx);
        }

        // Load parser & plugins.
        const parser = parserName && this._loadParser(parserName, ctx);
        const plugins = pluginList && this._loadPlugins(pluginList, ctx);

        // Yield pseudo config data for file extension processors.
        if (plugins) {
            yield* this._takeFileExtensionProcessors(plugins, ctx);
        }

        // Yield the config data except `extends` and `overrides`.
        yield {

            // Debug information.
            type: ctx.type,
            name: ctx.name,
            filePath: ctx.filePath,

            // Config data.
            criteria: null,
            env,
            globals,
            ignorePattern,
            noInlineConfig,
            parser,
            parserOptions,
            plugins,
            processor,
            reportUnusedDisableDirectives,
            root,
            rules,
            settings
        };

        // Flatten `overries`.
        for (let i = 0; i < overrideList.length; ++i) {
            yield* this._normalizeObjectConfigData(
                overrideList[i],
                { ...ctx, name: `${ctx.name}#overrides[${i}]` }
            );
        }
    }

    /**
     * Load configs of an element in `extends`.
     * @param {string} extendName The name of a base config.
     * @param {ConfigArrayFactoryLoadin{
  "name": "stable-hash",
  "version": "0.0.4",
  "description": "Stable JS value hash.",
  "repository": "https://github.com/shuding/stable-hash",
  "author": "Shu Ding",
  "license": "MIT",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    "require": "./dist/index.js",
    "import": "./dist/index.mjs",
    "types": "./dist/index.d.ts"
  },
  "files": [
    "dist/**"
  ],
  "devDependencies": {
    "@types/jest": "^28.1.3",
    "base64-url": "^2.3.3",
    "esbuild": "^0.12.28",
    "flattie": "^1.1.0",
    "hash-obj": "^4.0.0",
    "jest": "^28.1.1",
    "json-stringify-deterministic": "^1.0.7",
    "nanobench": "^2.1.1",
    "prettier": "^2.7.1",
    "ts-jest": "^28.0.5",
    "typescript": "^4.7.4"
  },
  "prettier": {
    "semi": false
  },
  "scripts": {
    "build:mjs": "esbuild src/index.ts --minify --target=es6 --outdir=dist --out-extension:.js=.mjs",
    "build:cjs": "esbuild src/index.ts --minify --target=es6 --outdir=dist --format=cjs",
    "build:types": "tsc --emitDeclarationOnly --declaration -p tsconfig.build.json",
    "build": "yarn build:mjs && yarn build:cjs && yarn build:types",
    "test": "jest"
  }
}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
| ----------- | ------------------------------------------------------------- |
| 197         | [jonschlinkert](https://github.com/jonschlinkert)             |
| 4           | [doowb](https://github.com/doowb)                             |
| 1           | [es128](https://github.com/es128)                             |
| 1           | [eush77](https://github.com/eush77)                           |
| 1           | [hemanth](https://github.com/hemanth)                         |
| 1           | [wtgtybhertgeghgtwtg](https://github.com/wtgtybhertgeghgtwtg) |

### Author

**Jon Schlinkert**

- [GitHub Profile](https://github.com/jonschlinkert)
- [Twitter Profile](https://twitter.com/jonschlinkert)
- [LinkedIn Profile](https://linkedin.com/in/jonschlinkert)

### License

Copyright Â© 2019, [Jon Schlinkert](https://github.com/jonschlinkert).
Released under the [MIT License](LICENSE).

---

_This file was generated by [verb-generate-readme](https://github.com/verbose/verb-generate-readme), v0.8.0, on April 08, 2019._
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               # @eslint-community/regexpp

[![npm version](https://img.shields.io/npm/v/@eslint-community/regexpp.svg)](https://www.npmjs.com/package/@eslint-community/regexpp)
[![Downloads/month](https://img.shields.io/npm/dm/@eslint-community/regexpp.svg)](http://www.npmtrends.com/@eslint-community/regexpp)
[![Build Status](https://github.com/eslint-community/regexpp/workflows/CI/badge.svg)](https://github.com/eslint-community/regexpp/actions)
[![codecov](https://codecov.io/gh/eslint-community/regexpp/branch/main/graph/badge.svg)](https://codecov.io/gh/eslint-community/regexpp)

A regular expression parser for ECMAScript.

## ðŸ’¿ Installation

```bash
$ npm install @eslint-community/regexpp
```

- require Node@^12.0.0 || ^14.0.0 || >=16.0.0.

## ðŸ“– Usage

```ts
import {
    AST,
    RegExpParser,
    RegExpValidator,
    RegExpVisitor,
    parseRegExpLiteral,
    validateRegExpLiteral,
    visitRegExpAST
} from "@eslint-community/regexpp"
```

### parseRegExpLiteral(source, options?)

Parse a given regular expression literal then make AST object.

This is equivalent to `new RegExpParser(options).parseLiteral(source)`.

- **Parameters:**
    - `source` (`string | RegExp`) The source code to parse.
    - `options?` ([`RegExpParser.Options`]) The options to parse.
- **Return:**
    - The AST of the regular expression.

### validateRegExpLiteral(source, options?)

Validate a given regular expression literal.

This is equivalent to `new RegExpValidator(options).validateLiteral(source)`.

- **Parameters:**
    - `source` (`string`) The source code to validate.
    - `options?` ([`RegExpValidator.Options`]) The options to validate.

### visitRegExpAST(ast, handlers)

Visit each node of a given AST.

This is equivalent to `new RegExpVisitor(handlers).visit(ast)`.

- **Parameters:**
    - `ast` ([`AST.Node`]) The AST to visit.
    - `handlers` ([`RegExpVisitor.Handlers`]) The callbacks.

### RegExpParser

#### new RegExpParser(options?)

- **Parameters:**
    - `options?` ([`RegExpParser.Options`]) The options to parse.

#### parser.parseLiteral(source, start?, end?)

Parse a regular expression literal.

- **Parameters:**
    - `source` (`string`) The source code to parse. E.g. `"/abc/g"`.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`) The end index in the source code. Default is `source.length`.
- **Return:**
    - The AST of the regular expression.

#### parser.parsePattern(source, start?, end?, flags?)

Parse a regular expression pattern.

- **Parameters:**
    - `source` (`string`) The source code to parse. E.g. `"abc"`.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`) The end index in the source code. Default is `source.length`.
    - `flags?` (`{ unicode?: boolean, unicodeSets?: boolean }`) The flags to enable Unicode mode, and Unicode Set mode.
- **Return:**
    - The AST of the regular expression pattern.

#### parser.parseFlags(source, start?, end?)

Parse a regular expression flags.

- **Parameters:**
    - `source` (`string`) The source code to parse. E.g. `"gim"`.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`) The end index in the source code. Default is `source.length`.
- **Return:**
    - The AST of the regular expression flags.

### RegExpValidator

#### new RegExpValidator(options)

- **Parameters:**
    - `options` ([`RegExpValidator.Options`]) The options to validate.

#### validator.validateLiteral(source, start, end)

Validate a regular expression literal.

- **Parameters:**
    - `source` (`string`) The source code to validate.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`) The end index in the source code. Default is `source.length`.

#### validator.validatePattern(source, start, end, flags)

Validate a regular expression pattern.

- **Parameters:**
    - `source` (`string`) The source code to validate.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`)# @eslint-community/eslint-utils

[![npm version](https://img.shields.io/npm/v/@eslint-community/eslint-utils.svg)](https://www.npmjs.com/package/@eslint-community/eslint-utils)
[![Downloads/month](https://img.shields.io/npm/dm/@eslint-community/eslint-utils.svg)](http://www.npmtrends.com/@eslint-community/eslint-utils)
[![Build Status](https://github.com/eslint-community/eslint-utils/workflows/CI/badge.svg)](https://github.com/eslint-community/eslint-utils/actions)
[![Coverage Status](https://codecov.io/gh/eslint-community/eslint-utils/branch/main/graph/badge.svg)](https://codecov.io/gh/eslint-community/eslint-utils)

## ðŸ Goal

This package provides utility functions and classes for make ESLint custom rules.

For examples:

-   [`getStaticValue`](https://eslint-community.github.io/eslint-utils/api/ast-utils.html#getstaticvalue) evaluates static value on AST.
-   [`ReferenceTracker`](https://eslint-community.github.io/eslint-utils/api/scope-utils.html#referencetracker-class) checks the members of modules/globals as handling assignments and destructuring.

## ðŸ“– Usage

See [documentation](https://eslint-community.github.io/eslint-utils).

## ðŸ“° Changelog

See [releases](https://github.com/eslint-community/eslint-utils/releases).

## â¤ï¸ Contributing

Welcome contributing!

Please use GitHub's Issues/PRs.

### Development Tools

-   `npm test` runs tests and measures coverage.
-   `npm run clean` removes the coverage result of `npm test` command.
-   `npm run coverage` shows the coverage result of the last `npm test` command.
-   `npm run lint` runs ESLint.
-   `npm run watch` runs tests on each file change.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   "use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fsScandir = require("@nodelib/fs.scandir");
class Settings {
    constructor(_options = {}) {
        this._options = _options;
        this.basePath = this._getValue(this._options.basePath, undefined);
        this.concurrency = this._getValue(this._options.concurrency, Number.POSITIVE_INFINITY);
        this.deepFilter = this._getValue(this._options.deepFilter, null);
        this.entryFilter = this._getValue(this._options.entryFilter, null);
        this.errorFilter = this._getValue(this._options.errorFilter, null);
        this.pathSegmentSeparator = this._getValue(this._options.pathSegmentSeparator, path.sep);
        this.fsScandirSettings = new fsScandir.Settings({
            followSymbolicLinks: this._options.followSymbolicLinks,
            fs: this._options.fs,
            pathSegmentSeparator: this._options.pathSegmentSeparator,
            stats: this._options.stats,
            throwErrorOnBrokenSymbolicLink: this._options.throwErrorOnBrokenSymbolicLink
        });
    }
    _getValue(option, value) {
        return option !== null && option !== void 0 ? option : value;
    }
}
exports.default = Settings;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              # @nodelib/fs.stat

> Get the status of a file with some features.

## :bulb: Highlights

Wrapper around standard method `fs.lstat` and `fs.stat` with some features.

* :beginner: Normally follows symbolic link.
* :gear: Can safely work with broken symbolic link.

## Install

```console
npm install @nodelib/fs.stat
```

## Usage

```ts
import * as fsStat from '@nodelib/fs.stat';

fsStat.stat('path', (error, stats) => { /* â€¦ */ });
```

## API

### .stat(path, [optionsOrSettings], callback)

Returns an instance of `fs.Stats` class for provided path with standard callback-style.

```ts
fsStat.stat('path', (error, stats) => { /* â€¦ */ });
fsStat.stat('path', {}, (error, stats) => { /* â€¦ */ });
fsStat.stat('path', new fsStat.Settings(), (error, stats) => { /* â€¦ */ });
```

### .statSync(path, [optionsOrSettings])

Returns an instance of `fs.Stats` class for provided path.

```ts
const stats = fsStat.stat('path');
const stats = fsStat.stat('path', {});
const stats = fsStat.stat('path', new fsStat.Settings());
```

#### path

* Required: `true`
* Type: `string | Buffer | URL`

A path to a file. If a URL is provided, it must use the `file:` protocol.

#### optionsOrSettings

* Required: `false`
* Type: `Options | Settings`
* Default: An instance of `Settings` class

An [`Options`](#options) object or an instance of [`Settings`](#settings) class.

> :book: When you pass a plain object, an instance of the `Settings` class will be created automatically. If you plan to call the method frequently, use a pre-created instance of the `Settings` class.

### Settings([options])

A class of full settings of the package.

```ts
const settings = new fsStat.Settings({ followSymbolicLink: false });

const stats = fsStat.stat('path', settings);
```

## Options

### `followSymbolicLink`

* Type: `boolean`
* Default: `true`

Follow symbolic link or not. Call `fs.stat` on symbolic link if `true`.

### `markSymbolicLink`

* Type: `boolean`
* Default: `false`

Mark symbolic link by setting the return value of `isSymbolicLink` function to always `true` (even after `fs.stat`).

> :book: Can be used if you want to know what is hidden behind a symbolic link, but still continue to know that it is a symbolic link.

### `throwErrorOnBrokenSymbolicLink`

* Type: `boolean`
* Default: `true`

Throw an error when symbolic link is broken if `true` or safely return `lstat` call if `false`.

### `fs`

* Type: [`FileSystemAdapter`](./src/adapters/fs.ts)
* Default: A default FS methods

By default, the built-in Node.js module (`fs`) is used to work with the file system. You can replace any method with your own.

```ts
interface FileSystemAdapter {
	lstat?: typeof fs.lstat;
	stat?: typeof fs.stat;
	lstatSync?: typeof fs.lstatSync;
	statSync?: typeof fs.statSync;
}

const settings = new fsStat.Settings({
	fs: { lstat: fakeLstat }
});
```

## Changelog

See the [Releases section of our GitHub project](https://github.com/nodelib/nodelib/releases) for changelog for each release version.

## License

This software is released under the terms of the MIT license.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             dioRole.default], ['meter', _meterRole.default], ['navigation', _navigationRole.default], ['none', _noneRole.default], ['note', _noteRole.default], ['option', _optionRole.default], ['paragraph', _paragraphRole.default], ['presentation', _presentationRole.default], ['progressbar', _progressbarRole.default], ['radio', _radioRole.default], ['radiogroup', _radiogroupRole.default], ['region', _regionRole.default], ['row', _rowRole.default], ['rowgroup', _rowgroupRole.default], ['rowheader', _rowheaderRole.default], ['scrollbar', _scrollbarRole.default], ['search', _searchRole.default], ['searchbox', _searchboxRole.default], ['separator', _separatorRole.default], ['slider', _sliderRole.default], ['spinbutton', _spinbuttonRole.default], ['status', _statusRole.default], ['strong', _strongRole.default], ['subscript', _subscriptRole.default], ['superscript', _superscriptRole.default], ['switch', _switchRole.default], ['tab', _tabRole.default], ['table', _tableRole.default], ['tablist', _tablistRole.default], ['tabpanel', _tabpanelRole.default], ['term', _termRole.default], ['textbox', _textboxRole.default], ['time', _timeRole.default], ['timer', _timerRole.default], ['toolbar', _toolbarRole.default], ['tooltip', _tooltipRole.default], ['tree', _treeRole.default], ['treegrid', _treegridRole.default], ['treeitem', _treeitemRole.default]];
var _default = exports.default = ariaLiteralRoles;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         {
	"name": "has-tostringtag",
	"version": "1.0.2",
	"author": {
		"name": "Jordan Harband",
		"email": "ljharb@gmail.com",
		"url": "http://ljharb.codes"
	},
	"funding": {
		"url": "https://github.com/sponsors/ljharb"
	},
	"contributors": [
		{
			"name": "Jordan Harband",
			"email": "ljharb@gmail.com",
			"url": "http://ljharb.codes"
		}
	],
	"description": "Determine if the JS environment has `Symbol.toStringTag` support. Supports spec, or shams.",
	"license": "MIT",
	"main": "index.js",
	"types": "./index.d.ts",
	"exports": {
		".": [
			{
				"types": "./index.d.ts",
				"default": "./index.js"
			},
			"./index.js"
		],
		"./shams": [
			{
				"types": "./shams.d.ts",
				"default": "./shams.js"
			},
			"./shams.js"
		],
		"./package.json": "./package.json"
	},
	"scripts": {
		"prepack": "npmignore --auto --commentLines=autogenerated",
		"prepublishOnly": "safe-publish-latest",
		"prepublish": "not-in-publish || npm run prepublishOnly",
		"pretest": "npm run --silent lint",
		"test": "npm run tests-only",
		"posttest": "aud --production",
		"tests-only": "npm run test:stock && npm run test:shams",
		"test:stock": "nyc node test",
		"test:staging": "nyc node --harmony --es-staging test",
		"test:shams": "npm run --silent test:shams:getownpropertysymbols && npm run --silent test:shams:corejs",
		"test:shams:corejs": "nyc node test/shams/core-js.js",
		"test:shams:getownpropertysymbols": "nyc node test/shams/get-own-property-symbols.js",
		"lint": "eslint --ext=js,mjs .",
		"version": "auto-changelog && git add CHANGELOG.md",
		"postversion": "auto-changelog && git add CHANGELOG.md && git commit --no-edit --amend && git tag -f \"v$(node -e \"console.log(require('./package.json').version)\")\""
	},
	"repository": {
		"type": "git",
		"url": "git+https://github.com/inspect-js/has-tostringtag.git"
	},
	"bugs": {
		"url": "https://github.com/inspect-js/has-tostringtag/issues"
	},
	"homepage": "https://github.com/inspect-js/has-tostringtag#readme",
	"keywords": [
		"javascript",
		"ecmascript",
		"symbol",
		"symbols",
		"tostringtag",
		"Symbol.toStringTag"
	],
	"devDependencies": {
		"@ljharb/eslint-config": "^21.1.0",
		"@types/has-symbols": "^1.0.2",
		"@types/tape": "^5.6.4",
		"aud": "^2.0.4",
		"auto-changelog": "^2.4.0",
		"core-js": "^2.6.12",
		"eslint": "=8.8.0",
		"get-own-property-symbols": "^0.9.5",
		"in-publish": "^2.0.1",
		"npmignore": "^0.3.1",
		"nyc": "^10.3.2",
		"safe-publish-latest": "^2.0.0",
		"tape": "^5.7.4",
		"typescript": "next"
	},
	"engines": {
		"node": ">= 0.4"
	},
	"auto-changelog": {
		"output": "CHANGELOG.md",
		"template": "keepachangelog",
		"unreleased": false,
		"commitLimit": false,
		"backfillLimit": false,
		"hideCredit": true
	},
	"publishConfig": {
		"ignore": [
			".github/workflows"
		]
	},
	"dependencies": {
		"has-symbols": "^1.0.3"
	}
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          lkj": 3896,
	"lkl": 3897,
	"lkm": 3898,
	"lkn": 3899,
	"lko": 3900,
	"lkr": 3901,
	"lks": 3902,
	"lkt": 3903,
	"lku": 3904,
	"lky": 3905,
	"lla": 3906,
	"llb": 3907,
	"llc": 3908,
	"lld": 3909,
	"lle": 3910,
	"llf": 3911,
	"llg": 3912,
	"llh": 3913,
	"lli": 3914,
	"llj": 3915,
	"llk": 3916,
	"lll": 3917,
	"llm": 3918,
	"lln": 3919,
	"llo": 3920,
	"llp": 3921,
	"llq": 3922,
	"lls": 3923,
	"llu": 3924,
	"llx": 3925,
	"lma": 3926,
	"lmb": 3927,
	"lmc": 3928,
	"lmd": 3929,
	"lme": 3930,
	"lmf": 3931,
	"lmg": 3932,
	"lmh": 3933,
	"lmi": 3934,
	"lmj": 3935,
	"lmk": 3936,
	"lml": 3937,
	"lmm": 3938,
	"lmn": 3939,
	"lmo": 3940,
	"lmp": 3941,
	"lmq": 3942,
	"lmr": 3943,
	"lmu": 3944,
	"lmv": 3945,
	"lmw": 3946,
	"lmx": 3947,
	"lmy": 3948,
	"lmz": 3949,
	"lna": 3950,
	"lnb": 3951,
	"lnd": 3952,
	"lng": 3953,
	"lnh": 3954,
	"lni": 3955,
	"lnj": 3956,
	"lnl": 3957,
	"lnm": 3958,
	"lnn": 3959,
	"lno": 3960,
	"lns": 3961,
	"lnu": 3962,
	"lnw": 3963,
	"lnz": 3964,
	"loa": 3965,
	"lob": 3966,
	"loc": 3967,
	"loe": 3968,
	"lof": 3969,
	"log": 3970,
	"loh": 3971,
	"loi": 3972,
	"loj": 3973,
	"lok": 3974,
	"lol": 3975,
	"lom": 3976,
	"lon": 3977,
	"loo": 3978,
	"lop": 3979,
	"loq": 3980,
	"lor": 3981,
	"los": 3982,
	"lot": 3983,
	"lou": 3984,
	"lov": 3985,
	"low": 3986,
	"lox": 3987,
	"loy": 3988,
	"loz": 3989,
	"lpa": 3990,
	"lpe": 3991,
	"lpn": 3992,
	"lpo": 3993,
	"lpx": 3994,
	"lqr": 3995,
	"lra": 3996,
	"lrc": 3997,
	"lre": 3998,
	"lrg": 3999,
	"lri": 4000,
	"lrk": 4001,
	"lrl": 4002,
	"lrm": 4003,
	"lrn": 4004,
	"lro": 4005,
	"lrr": 4006,
	"lrt": 4007,
	"lrv": 4008,
	"lrz": 4009,
	"lsa": 4010,
	"lsb": 4011,
	"lsc": 4012,
	"lsd": 4013,
	"lse": 4014,
	"lsg": 4015,
	"lsh": 4016,
	"lsi": 4017,
	"lsl": 4018,
	"lsm": 4019,
	"lsn": 4020,
	"lso": 4021,
	"lsp": 4022,
	"lsr": 4023,
	"lss": 4024,
	"lst": 4025,
	"lsv": 4026,
	"lsw": 4027,
	"lsy": 4028,
	"ltc": 4029,
	"ltg": 4030,
	"lth": 4031,
	"lti": 4032,
	"ltn": 4033,
	"lto": 4034,
	"lts": 4035,
	"ltu": 4036,
	"lua": 4037,
	"luc": 4038,
	"lud": 4039,
	"lue": 4040,
	"luf": 4041,
	"lui": 4042,
	"luj": 4043,
	"luk": 4044,
	"lul": 4045,
	"lum": 4046,
	"lun": 4047,
	"luo": 4048,
	"lup": 4049,
	"luq": 4050,
	"lur": 4051,
	"lus": 4052,
	"lut": 4053,
	"luu": 4054,
	"luv": 4055,
	"luw": 4056,
	"luy": 4057,
	"luz": 4058,
	"lva": 4059,
	"lvi": 4060,
	"lvk": 4061,
	"lvl": 4062,
	"lvs": 4063,
	"lvu": 4064,
	"lwa": 4065,
	"lwe": 4066,
	"lwg": 4067,
	"lwh": 4068,
	"lwl": 4069,
	"lwm": 4070,
	"lwo": 4071,
	"lws": 4072,
	"lwt": 4073,
	"lwu": 4074,
	"lww": 4075,
	"lxm": 4076,
	"lya": 4077,
	"lyg": 4078,
	"lyn": 4079,
	"lzh": 4080,
	"lzl": 4081,
	"lzn": 4082,
	"lzz": 4083,
	"maa": 4084,
	"mab": 4085,
	"mad": 4086,
	"mae": 4087,
	"maf": 4088,
	"mag": 4089,
	"mai": 4090,
	"maj": 4091,
	"mak": 4092,
	"mam": 4093,
	"man": 4094,
	"map": 4095,
	"maq": 4096,
	"mas": 4097,
	"mat": 4098,
	"mau": 4099,
	"mav": 4100,
	"maw": 4101,
	"max": 4102,
	"maz": 4103,
	"mba": 4104,
	"mbb": 4105,
	"mbc": 4106,
	"mbd": 4107,
	"mbe": 4108,
	"mbf": 4109,
	"mbh": 4110,
	"mbi": 4111,
	"mbj": 4112,
	"mbk": 4113,
	"mbl": 4114,
	"mbm": 4115,
	"mbn": 4116,
	"mbo": 4117,
	"mbp": 4118,
	"mbq": 4119,
	"mbr": 4120,
	"mbs": 4121,
	"mbt": 4122,
	"mbu": 4123,
	"mbv": 4124,
	"mbw": 4125,
	"mbx": 4126,
	"mby": 4127,
	"mbz": 4128,
	"mca": 4129,
	"mcb": 4130,
	"mcc": 4131,
	"mcd": 4132,
	"mce": 4133,
	"mcf": 4134,
	"mcg": 4135,
	"mch": 4136,
	"mci": 4137,
	"mcj": 4138,
	"mck": 4139,
	"mcl": 4140,
	"mcm": 4141,
	"mcn": 4142,
	"mco": 4143,
	"mcp": 4144,
	"mcq": 4145,
	"mcr": 4146,
	"mcs": 4147,
	"mct": 4148,
	"mcu": 4149,
	"mcv": 4150,
	"mcw": 4151,
	"mcx": 4152,
	"mcy": 4153,
	"mcz": 4154,
	"mda": 4155,
	"mdb": 4156,
	"mdc": 4157,
	"mdd": 4158,
	"mde": 4159,
	"mdf": 4160,
	"mdg": 4161,
	"mdh": 4162,
	"mdi": 4163,
	"mdj": 4164,
	"mdk": 4165,
	"mdl": 4166,
	"mdm": 4167,
	"mdn": 4168,
	"mdp": 4169,
	"mdq": 4170,
	"mdr": 4171,
	"mds": 4172,
	"mdt": 4173,
	"mdu": 4174,
	"mdv": 4175,
	"mdw": 4176,
	"mdx": 4177,
	"mdy": 4178,
	"mdz": 4179,
	"mea": 4180,
	"meb": 4181,
	"mec": 4182,
	"med": 4183,
	"mee": 4184,
	"mef": 4185,
	"meg": 4186,
	"meh": 4187,
	"mei": 4188,
	"mej": 4189,
	"mek": 4190,
	"mel": 4191,
	"mem": 4192,
	"men": 4193,
	"meo": 4194,
	"mep": 4195,
	"meq": 4196,
	"mer": 4197,
	"mes": 4198,
	"met": 4199,
	"meu": 4200,
	"mev": 4201,
	"mew": 4202,
	"mey": 4203,
	"mez": 4204,
	"mfa": 4205,
	"mfb": 4206,
	"mfc": 4207,
	"mfd": 4208,
	"mfe": 4209,
	"mff": 4210,
	"mfg": 4211,
	"mfh": 4212,
	"mfi": 4213,
	"mfj": 4214,
	"mfk": 4215,
	"mfl": 4216,
	"mfm": 4217,
	"mfn": 4218,
	"mfo": 4219,
	"mfp": 4220,
	"mfq": 4221,
	"mfr": 4222,
	"mfs": 4223,
	"mft": 4224,
	"mfu": 4225,
	"mfv": 4226,
	"mfw": 4227,
	"mfx": 4228,
	"mfy": 4229,
	"mfz": 4230,
	"mga": 4231,
	"mgb": 4232,
	"mgc": 4233,
	"mgd": 4234,
	"mge": 4235,
	"mgf": 4236,
	"mgg": 4237,
	"mgh": 4238,
	"mgi": 4239,
	"mgj": 4240,
	"mgk": 4241,
	"mgl": 4242,
	"mgm": 4243,
	"mgn": 4244,
	"mgo": 4245,
	"mgp": 4246,
	"mgq": 4247,
	"mgr": 4248,
	"mgs": 4249,
	"mgt": 4250,
	"mgu": 4251,
	"mgv": 4252,
	"mgw": 4253,
	"mgx": 4254,
	"mgy": 4255,
	"mgz": 4256,
	"mha": 4257,
	"mhb": 4258,
	"mhc": 4259,
	"mhd": 4260,
	"mhe": 4261,
	"mhf": 4262,
	"mhg": 4263,
	"mhh": 4264,
	"mhi": 4265,
	"mhj": 4266,
	"mhk": 4267,
	"mhl": 4268,
	"mhm": 4269,
	"mhn": 4270,
	"mho": 4271,
	"mhp": 4272,
	"mhq": 4273,
	"mhr": 4274,
	"mhs": 4275,
	"mht": 4276,
	"mhu": 4277,
	"mhw": 4278,
	"mhx": 4279,
	"mhy": 4280,
	"mhz": 4281,
	"mia": 4282,
	"mib": 4283,
	"mic": 4284,
	"mid": 4285,
	"mie": 4286,
	"mif": 4287,
	"mig": 4288,
	"mih": 4289,
	"mii": 4290,
	"mij": 4291,
	"mik": 4292,
	"mil": 4293,
	"mim": 4294,
	"min": 4295,
	"mio": 4296,
	"mip": 4297,
	"miq": 4298,
	"mir": 4299,
	"mis": 4300,
	"mit": 4301,
	"miu": 4302,
	"miw": 4303,
	"mix": 4304,
	"miy": 4305,
	"miz": 4306,
	"mja": 4307,
	"mjb": 4308,
	"mjc": 4309,
	"mjd": 4310,
	"mje": 4311,
	"mjg": 4312,
	"mjh": 4313,
	"mji": 4314,
	"mjj": 4315,
	"mjk": 4316,
	"mjl": 4317,
	"mjm": 4318,
	"mjn": 4319,
	"mjo": 4320,
	"mjp": 4321,
	"mjq": 4322,
	"mjr": 4323,
	"mjs": 4324,
	"mjt": 4325,
	"mju": 4326,
	"mjv": 4327,
	"mjw": 4328,
	"mjx": 4329,
	"mjy": 4330,
	"mjz": 4331,
	"mka": 4332,
	"mkb": 4333,
	"mkc": 4334,
	"mke": 4335,
	"mkf": 4336,
	"mkg": 4337,
	"mkh": 4338,
	"mki": 4339,
	"mkj": 4340,
	"mkk": 4341,
	"mkl": 4342,
	"mkm": 4343,
	"mkn": 4344,
	"mko": 4345,
	"mkp": 4346,
	"mkq": 4347,
	"mkr": 4348,
	"mks": 4349,
	"mkt": 4350,
	"mku": 4351,
	"mkv": 4352,
	"mkw": 4353,
	"mkx": 4354,
	"mky": 4355,
	"mkz": 4356,
	"mla": 4357,
	"mlb": 4358,
	"mlc": 4359,
	"mld": 4360,
	"mle": 4361,
	"mlf": 4362,
	"mlh": 4363,
	"mli": 4364,
	"mlj": 4365,
	"mlk": 4366,
	"mll": 4367,
	"mlm": 4368,
	"mln": 4369,
	"mlo": 4370,
	"mlp": 4371,
	"mlq": 4372,
	"mlr": 4373,
	"mls": 4374,
	"mlu": 4375,
	"mlv": 4376,
	"mlw": 4377,
	"mlx": 4378,
	"mlz": 4379,
	"mma": 4380,
	"mmb": 4381,
	"mmc": 4382,
	"mmd": 4383,
	"mme": 4384,
	"mmf": 4385,
	"mmg": 4386,
	"mmh": 4387,
	"mmi": 4388,
	"mmj": 4389,
	"mmk": 4390,
	"mml": 4391,
	"mmm": 4392,
	"mmn": 4393,
	"mmo": 4394,
	"mmp": 4395,
	"mmq": 4396,
	"mmr": 4397,
	"mmt": 4398,
	"mmu": 4399,
	"mmv": 4400,
	"mmw": 4401,
	"mmx": 4402,
	"mmy": 4403,
	"mmz": 4404,
	"mna": 4405,
	"mnb": 4406,
	"mnc": 4407,
	"mnd": 4408,
	"mne": 4409,
	"mnf": 4410,
	"mng": 4411,
	"mnh": 4412,
	"mni": 4413,
	"mnj": 4414,
	"mnk": 4415,
	"mnl": 4416,
	"mnm": 4417,
	"mnn": 4418,
	"mno": 4419,
	"mnp": 4420,
	"mnq": 4421,
	"mnr": 4422,
	"mns": 4423,
	"mnt": 4424,
	"mnu": 4425,
	"mnv": 4426,
	"mnw": 4427,
	"mnx": 4428,
	"mny": 4429,
	"mnz": 4430,
	"moa": 4431,
	"moc": 4432,
	"mod": 4433,
	"moe": 4434,
	"mof": 4435,
	"mog": 4436,
	"moh": 4437,
	"moi": 4438,
	"moj": 4439,
	"mok": 4440,
	"mom": 4441,
	"moo": 4442,
	"mop": 4443,
	"moq": 4444,
	"mor": 4445,
	"mos": 4446,
	"mot": 4447,
	"mou": 4448,
	"mov": 4449,
	"mow": 4450,
	"mox": 4451,
	"moy": 4452,
	"moz": 4453,
	"mpa": 4454,
	"mpb": 4455,
	"mpc": 4456,
	"mpd": 4457,
	"mpe": 4458,
	"mpg": 4459,
	"mph": 4460,
	"mpi": 4461,
	"mpj": 4462,
	"mpk": 4463,
	"mpl": 4464,
	"mpm": 4465,
	"mpn": 4466,
	"mpo": 4467,
	"mpp": 4468,
	"mpq": 4469,
	"mpr": 4470,
	"mps": 4471,
	"mpt": 4472,
	"mpu": 4473,
	"mpv": 4474,
	"mpw": 4475,
	"mpx": 4476,
	"mpy": 4477,
	"mpz": 4478,
	"mqa": 4479,
	"mqb": 4480,
	"mqc": 4481,
	"mqe": 4482,
	"mqf": 4483,
	"mqg": 4484,
	"mqh": 4485,
	"mqi": 4486,
	"mqj": 4487,
	"mqk": 4488,
	"mql": 4489,
	"mqm": 4490,
	"mqn": 4491,
	"mqo": 4492,
	"mqp": 4493,
	"mqq": 4494,
	"mqr": 4495,
	"mqs": 4496,
	"mqt": 4497,
	"mqu": 4498,
	"mqv": 4499,
	"mqw": 4500,
	"mqx": 4501,
	"mqy": 4502,
	"mqz": 4503,
	"mra": 4504,
	"mrb": 4505,
	"mrc": 4506,
	"mrd": 4507,
	"mre": 4508,
	"mrf": 4509,
	"mrg": 4510,
	"mrh": 4511,
	"mrj": 4512,
	"mrk": 4513,
	"mrl": 4514,
	"mrm": 4515,
	"mrn": 4516,
	"mro": 4517,
	"mrp": 4518,
	"mrq": 4519,
	"mrr": 4520,
	"mrs": 4521,
	"mrt": 4522,
	"mru": 4523,
	"mrv": 4524,
	"mrw": 4525,
	"mrx": 4526,
	"mry": 4527,
	"mrz": 4528,
	"msb": 4529,
	"msc": 4530,
	"msd": 4531,
	"mse": 4532,
	"msf": 4533,
	"msg": 4534,
	"msh": 4535,
	"msi": 4536,
	"msj": 4537,
	"msk": 4538,
	"msl": 4539,
	"msm": 4540,
	"msn": 4541,
	"mso": 4542,
	"msp": 4543,
	"msq": 4544,
	"msr": 4545,
	"mss": 4546,
	"mst": 4547,
	"msu": 4548,
	"msv": 4549,
	"msw": 4550,
	"msx": 4551,
	"msy": 4552,
	"msz": 4553,
	"mta": 4554,
	"mtb": 4555,
	"mtc": 4556,
	"mtd": 4557,
	"mte": 4558,
	"mtf": 4559,
	"mtg": 4560,
	"mth": 4561,
	"mti": 4562,
	"mtj": 4563,
	"mtk": 4564,
	"mtl": 4565,
	"mtm": 4566,
	"mtn": 4567,
	"mto": 4568,
	"mtp": 4569,
	"mtq": 4570,
	"mtr": 4571,
	"mts": 4572,
	"mtt": 4573,
	"mtu": 4574,
	"mtv": 4575,
	"mtw": 4576,
	"mtx": 4577,
	"mty": 4578,
	"mua": 4579,
	"mub": 4580,
	"muc": 4581,
	"mud": 4582,
	"mue": 4583,
	"mug": 4584,
	"muh": 4585,
	"mui": 4586,
	"muj": 4587,
	"muk": 4588,
	"mul": 4589,
	"mum": 4590,
	"mun": 4591,
	"muo": 4592,
	"mup": 4593,
	"muq": 4594,
	"mur": 4595,
	"mus": 4596,
	"mut": 4597,
	"muu": 4598,
	"muv": 4599,
	"mux": 4600,
	"muy": 4601,
	"muz": 4602,
	"mva": 4603,
	"mvb": 4604,
	"mvd": 4605,
	"mve": 4606,
	"mvf": 4607,
	"mvg": 4608,
	"mvh": 4609,
	"mvi": 4610,
	"mvk": 4611,
	"mvl": 4612,
	"mvm": 4613,
	"mvn": 4614,
	"mvo": 4615,
	"mvp": 4616,
	"mvq": 4617,
	"mvr": 4618,
	"mvs": 4619,
	"mvt": 4620,
	"mvu": 4621,
	"mvv": 4622,
	"mvw": 4623,
	"mvx": 4624,
	"mvy": 4625,
	"mvz": 4626,
	"mwa": 4627,
	"mwb": 4628,
	"mwc": 4629,
	"mwd": 4630,
	"mwe": 4631,
	"mwf": 4632,
	"mwg": 4633,
	"mwh": 4634,
	"mwi": 4635,
	"mwj": 4636,
	"mwk": 4637,
	"mwl": 4638,
	"mwm": 4639,
	"mwn": 4640,
	"mwo": 4641,
	"mwp": 4642,
	"mwq": 4643,
	"mwr": 4644,
	"mws": 4645,
	"mwt": 4646,
	"mwu": 4647,
	"mwv": 4648,
	"mww": 4649,
	"mwx": 4650,
	"mwy": 4651,
	"mwz": 4652,
	"mxa": 4653,
	"mxb": 4654,
	"mxc": 4655,
	"mxd": 4656,
	"mxe": 4657,
	"mxf": 4658,
	"mxg": 4659,
	"mxh": 4660,
	"mxi": 4661,
	"mxj": 4662,
	"mxk": 4663,
	"mxl": 4664,
	"mxm": 4665,
	"mxn": 4666,
	"mxo": 4667,
	"mxp": 4668,
	"mxq": 4669,
	"mxr": 4670,
	"mxs": 4671,
	"mxt": 4672,
	"mxu": 4673,
	"mxv": 4674,
	"mxw": 4675,
	"mxx": 4676,
	"mxy": 4677,
	"mxz": 4678,
	"myb": 4679,
	"myc": 4680,
	"myd": 4681,
	"mye": 4682,
	"myf": 4683,
	"myg": 4684,
	"myh": 4685,
	"myi": 4686,
	"myj": 4687,
	"myk": 4688,
	"myl": 4689,
	"mym": 4690,
	"myn": 4691,
	"myo": 4692,
	"myp": 4693,
	"myq": 4694,
	"myr": 4695,
	"mys": 4696,
	"myt": 4697,
	"myu": 4698,
	"myv": 4699,
	"myw": 4700,
	"myx": 4701,
	"myy": 4702,
	"myz": 4703,
	"mza": 4704,
	"mzb": 4705,
	"mzc": 4706,
	"mzd": 4707,
	"mze": 4708,
	"mzg": 4709,
	"mzh": 4710,
	"mzi": 4711,
	"mzj": 4712,
	"mzk": 4713,
	"mzl": 4714,
	"mzm": 4715,
	"mzn": 4716,
	"mzo": 4717,
	"mzp": 4718,
	"mzq": 4719,
	"mzr": 4720,
	"mzs": 4721,
	"mzt": 4722,
	"mzu": 4723,
	"mzv": 4724,
	"mzw": 4725,
	"mzx": 4726,
	"mzy": 4727,
	"mzz": 4728,
	"naa": 4729,
	"nab": 4730,
	"nac": 4731,
	"nad": 4732,
	"nae": 4733,
	"naf": 4734,
	"nag": 4735,
	"nah": 4736,
	"nai": 4737,
	"naj": 4738,
	"nak": 4739,
	"nal": 4740,
	"nam": 4741,
	"nan": 4742,
	"nao": 4743,
	"nap": 4744,
	"naq": 4745,
	"nar": 4746,
	"nas": 4747,
	"nat": 4748,
	"naw": 4749,
	"nax": 4750,
	"nay": 4751,
	"naz": 4752,
	"nba": 4753,
	"nbb": 4754,
	"nbc": 4755,
	"nbd": 4756,
	"nbe": 4757,
	"nbf": 4758,
	"nbg": 4759,
	"nbh": 4760,
	"nbi": 4761,
	"nbj": 4762,
	"nbk": 4763,
	"nbm": 4764,
	"nbn": 4765,
	"nbo": 4766,
	"nbp": 4767,
	"nbq": 4768,
	"nbr": 4769,
	"nbs": 4770,
	"nbt": 4771,
	"nbu": 4772,
	"nbv": 4773,
	"nbw": 4774,
	"nbx": 4775,
	"nby": 4776,
	"nca": 4777,
	"ncb": 4778,
	"ncc": 4779,
	"ncd": 4780,
	"nce": 4781,
	"ncf": 4782,
	"ncg": 4783,
	"nch": 4784,
	"nci": 4785,
	"ncj": 4786,
	"nck": 4787,
	"ncl": 4788,
	"ncm": 4789,
	"ncn": 4790,
	"nco": 4791,
	"ncp": 4792,
	"ncq": 4793,
	"ncr": 4794,
	"ncs": 4795,
	"nct": 4796,
	"ncu": 4797,
	"ncx": 4798,
	"ncz": 4799,
	"nda": 4800,
	"ndb": 4801,
	"ndc": 4802,
	"ndd": 4803,
	"ndf": 4804,
	"ndg": 4805,
	"ndh": 4806,
	"ndi": 4807,
	"ndj": 4808,
	"ndk": 4809,
	"ndl": 4810,
	"ndm": 4811,
	"ndn": 4812,
	"ndp": 4813,
	"ndq": 4814,
	"ndr": 4815,
	"nds": 4816,
	"ndt": 4817,
	"ndu": 4818,
	"ndv": 4819,
	"ndw": 4820,
	"ndx": 4821,
	"ndy": 4822,
	"ndz": 4823,
	"nea": 4824,
	"neb": 4825,
	"nec": 4826,
	"ned": 4827,
	"nee": 4828,
	"nef": 4829,
	"neg": 4830,
	"neh": 4831,
	"nei": 4832,
	"nej": 4833,
	"nek": 4834,
	"nem": 4835,
	"nen": 4836,
	"neo": 4837,
	"neq": 4838,
	"ner": 4839,
	"nes": 4840,
	"net": 4841,
	"neu": 4842,
	"nev": 4843,
	"new": 4844,
	"nex": 4845,
	"ney": 4846,
	"nez": 4847,
	"nfa": 4848,
	"nfd": 4849,
	"nfl": 4850,
	"nfr": 4851,
	"nfu": 4852,
	"nga": 4853,
	"ngb": 4854,
	"ngc": 4855,
	"ngd": 4856,
	"nge": 4857,
	"ngf": 4858,
	"ngg": 4859,
	"ngh": 4860,
	"ngi": 4861,
	"ngj": 4862,
	"ngk": 4863,
	"ngl": 4864,
	"ngm": 4865,
	"ngn": 4866,
	"ngo": 4867,
	"ngp": 4868,
	"ngq": 4869,
	"ngr": 4870,
	"ngs": 4871,
	"ngt": 4872,
	"ngu": 4873,
	"ngv": 4874,
	"ngw": 4875,
	"ngx": 4876,
	"ngy": 4877,
	"ngz": 4878,
	"nha": 4879,
	"nhb": 4880,
	"nhc": 4881,
	"nhd": 4882,
	"nhe": 4883,
	"nhf": 4884,
	"nhg": 4885,
	"nhh": 4886,
	"nhi": 4887,
	"nhk": 4888,
	"nhm": 4889,
	"nhn": 4890,
	"nho": 4891,
	"nhp": 4892,
	"nhq": 4893,
	"nhr": 4894,
	"nht": 4895,
	"nhu": 4896,
	"nhv": 4897,
	"nhw": 4898,
	"nhx": 4899,
	"nhy": 4900,
	"nhz": 4901,
	"nia": 4902,
	"nib": 4903,
	"nic": 4904,
	"nid": 4905,
	"nie": 4906,
	"nif": 4907,
	"nig": 4908,
	"nih": 4909,
	"nii": 4910,
	"nij": 4911,
	"nik": 4912,
	"nil": 4913,
	"nim": 4914,
	"nin": 4915,
	"nio": 4916,
	"niq": 4917,
	"nir": 4918,
	"nis": 4919,
	"nit": 4920,
	"niu": 4921,
	"niv": 4922,
	"niw": 4923,
	"nix": 4924,
	"niy": 4925,
	"niz": 4926,
	"nja": 4927,
	"njb": 4928,
	"njd": 4929,
	"njh": 4930,
	"nji": 4931,
	"njj": 4932,
	"njl": 4933,
	"njm": 4934,
	"njn": 4935,
	"njo": 4936,
	"njr": 4937,
	"njs": 4938,
	"njt": 4939,
	"nju": 4940,
	"njx": 4941,
	"njy": 4942,
	"njz": 4943,
	"nka": 4944,
	"nkb": 4945,
	"nkc": 4946,
	"nkd": 4947,
	"nke": 4948,
	"nkf": 4949,
	"nkg": 4950,
	"nkh": 4951,
	"nki": 4952,
	"nkj": 4953,
	"nkk": 4954,
	"nkm": 4955,
	"nkn": 4956,
	"nko": 4957,
	"nkp": 4958,
	"nkq": 4959,
	"nkr": 4960,
	"nks": 4961,
	"nkt": 4962,
	"nku": 4963,
	"nkv": 4964,
	"nkw": 4965,
	"nkx": 4966,
	"nkz": 4967,
	"nla": 4968,
	"nlc": 4969,
	"nle": 4970,
	"nlg": 4971,
	"nli": 4972,
	"nlj": 4973,
	"nlk": 4974,
	"nll": 4975,
	"nlm": 4976,
	"nln": 4977,
	"nlo": 4978,
	"nlq": 4979,
	"nlr": 4980,
	"nlu": 4981,
	"nlv": 4982,
	"nlw": 4983,
	"nlx": 4984,
	"nly": 4985,
	"nlz": 4986,
	"nma": 4987,
	"nmb": 4988,
	"nmc": 4989,
	"nmd": 4990,
	"nme": 4991,
	"nmf": 4992,
	"nmg": 4993,
	"nmh": 4994,
	"nmi": 4995,
	"nmj": 4996,
	"nmk": 4997,
	"nml": 4998,
	"nmm": 4999,
	"nmn": 5000,
	"nmo": 5001,
	"nmp": 5002,
	"nmq": 5003,
	"nmr": 5004,
	"nms": 5005,
	"nmt": 5006,
	"nmu": 5007,
	"nmv": 5008,
	"nmw": 5009,
	"nmx": 5010,
	"nmy": 5011,
	"nmz": 5012,
	"nna": 5013,
	"nnb": 5014,
	"nnc": 5015,
	"nnd": 5016,
	"nne": 5017,
	"nnf": 5018,
	"nng": 5019,
	"nnh": 5020,
	"nni": 5021,
	"nnj": 5022,
	"nnk": 5023,
	"nnl": 5024,
	"nnm": 5025,
	"nnn": 5026,
	"nnp": 5027,
	"nnq": 5028,
	"nnr": 5029,
	"nns": 5030,
	"nnt": 5031,
	"nnu": 5032,
	"nnv": 5033,
	"nnw": 5034,
	"nnx": 5035,
	"nny": 5036,
	"nnz": 5037,
	"noa": 5038,
	"noc": 5039,
	"nod": 5040,
	"noe": 5041,
	"nof": 5042,
	"nog": 5043,
	"noh": 5044,
	"noi": 5045,
	"noj": 5046,
	"nok": 5047,
	"nol": 5048,
	"nom": 5049,
	"non": 5050,
	"noo": 5051,
	"nop": 5052,
	"noq": 5053,
	"nos": 5054,
	"not": 5055,
	"nou": 5056,
	"nov": 5057,
	"now": 5058,
	"noy": 5059,
	"noz": 5060,
	"npa": 5061,
	"npb": 5062,
	"npg": 5063,
	"nph": 5064,
	"npi": 5065,
	"npl"INDX( 	 ÎL            (   €  è                            ¸E    h T     lE    ×Æ‚eÛQ±Æ‚eÛQ±Æ‚eÛQ±Æ‚eÛÐ      Ð              	 a s s e r t . j s     ÀF    p \     lE    Ñµ%Æ‚eÛ	£'Æ‚eÛ	£'Æ‚eÛ	£'Æ‚eÛ       $               d e f i n i t i o n . j s     ¢G    h R     lE    9¯-Æ‚eÛª„0Æ‚eÛª„0Æ‚eÛª„0Æ‚eÛ        ù               i n d e x . j s       †H    x f     lE    ó6Æ‚eÛ÷t6Æ‚eÛ÷t6Æ‚eÛ÷t6Æ‚eÛ        >               p a t t e r n - v i s i t o r . j s   7I    p Z     lE    ®Ç;Æ‚eÛœÔ<Æ‚eÛœÔ<Æ‚eÛœÔ<Æ‚eÛ        ¥               r e f e r e n c e . j s       ÜI    p \     lE    ¢7BÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛ P      mL               r e f e r e n c e r . j s     ÌJ    x b     lE    ¤ÁIÆ‚eÛPÓJÆ‚eÛPÓJÆ‚eÛPÓJÆ‚eÛ        „               s c o p e - m a n a g e r . j s       ZK    h R     lE    nGNÆ‚eÛÛæOÆ‚eÛÛæOÆ‚eÛÛæOÆ‚eÛ `      W               s c o p e . j s       ÙK    h X     lE    WRÆ‚eÛ%&SÆ‚eÛ%&SÆ‚eÛ%&SÆ‚eÛ       ;              v a r i a b l e . j s 'L    h V     lE    pWUÆ‚eÛNóUÆ‚eÛNóUÆ‚eÛNóUÆ‚eÛ8       2               
 v e r s i o n . j s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   # Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.1.0](https://github.com/inspect-js/is-generator-function/compare/v1.0.10...v1.1.0) - 2025-01-02

### Commits

- [actions] reuse common workflows [`7301651`](https://github.com/inspect-js/is-generator-function/commit/7301651ad24468ab17aee7a86a2dd2a6fcd58637)
- [actions] split out node 10-20, and 20+ [`40f30a5`](https://github.com/inspect-js/is-generator-function/commit/40f30a5dee3e26cad236ce0afbd0567b6075af54)
- [meta] use `npmignore` to autogenerate an npmignore file [`ec843a4`](https://github.com/inspect-js/is-generator-function/commit/ec843a4501d238fcde254c7e33c137ec997abfaa)
- [New] add types [`6dd27c4`](https://github.com/inspect-js/is-generator-function/commit/6dd27c4b6a3ebaa42ddbf4e93c20e2b4d90bad07)
- [actions] update codecov uploader [`717f85e`](https://github.com/inspect-js/is-generator-function/commit/717f85e8b080cdbdb160558b289ec9f043410bd2)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `safe-publish-latest`, `tape` [`4280e62`](https://github.com/inspect-js/is-generator-function/commit/4280e6260029ccdae8b299faadacafd0f8a2de78)
- [actions] update rebase action to use reusable workflow [`895c2d0`](https://github.com/inspect-js/is-generator-function/commit/895c2d06a914b82913d3fae2df3071bde72cb584)
- [Tests] use `for-each` [`3caee87`](https://github.com/inspect-js/is-generator-function/commit/3caee870b0509b91ad37e6a0562f261d7b5f4523)
- [Robustness] use `call-bound` [`1eb55de`](https://github.com/inspect-js/is-generator-function/commit/1eb55def663c335222d970c5e62459f73aee20db)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `aud`, `auto-changelog`, `object-inspect`, `tape` [`5bbd4cd`](https://github.com/inspect-js/is-generator-function/commit/5bbd4cd8bcbd167a05ddf1cd285fd1fd2802801a)
- [Robustness] use `safe-regex-test` [`5f8b992`](https://github.com/inspect-js/is-generator-function/commit/5f8b9921e4cf53c3cb4185a0f30a170fa2e0722f)
- [Dev Deps] update `@ljharb/eslint-config`, `auto-changelog`, `npmignore`, `tape` [`c730f4c`](https://github.com/inspect-js/is-generator-function/commit/c730f4c056697653ba935b37b44bf9bfe1017331)
- [Robustness] use `get-proto` [`6dfff38`](https://github.com/inspect-js/is-generator-function/commit/6dfff3821b8a42d0b0f70651abfe1d2e90afbb10)
- [Tests] replace `aud` with `npm audit` [`725db70`](https://github.com/inspect-js/is-generator-function/commit/725db703352200f7400fa4b2b2058e2220a4c42b)
- [Deps] update `has-tostringtag` [`5cc3c2d`](https://github.com/inspect-js/is-generator-function/commit/5cc3c2d34b77c3d7d50588225d4d4afa20aa3df2)
- [Dev Deps] add missing peer dep [`869a507`](https://github.com/inspect-js/is-generator-function/commit/869a507790e8cf1452b355719a6c00efadbe4965)

## [v1.0.10](https://github.com/inspect-js/is-generator-function/compare/v1.0.9...v1.0.10) - 2021-08-05

### Commits

- [Dev Deps] update `eslint`, `auto-changelog`, `core-js`, `tape` [`63cd935`](https://github.com/inspect-js/is-generator-function/commit/63cd9353eead5ad5eb8cf581fc4129841641bb43)
- [Fix] use `has-tostringtag` to behave correctly in the presence of symbol shams [`8c3fe76`](https://github.com/inspect-js/is-generator-function/commit/8c3fe76b546fbc5085381df65800e4fc67e25ede)
- [Dev Deps] unpin `core-js` v3 [`ebf2885`](https://github.com/inspect-js/is-generator-function/commit/ebf2885bc202b59f37e074f28951639873c6f38e)

## [v1.0.9](https://github.com/inspect-js/is-generator-function/compare/v1.0.8...v1.0.9) - 2021-05-05

### Fixed

- [Fix] avoid calling `Function` until absolutely necessary [`#41`](https://github.com/inspect-js/is-generator-function/issues/41)

### Commits

- [actions] use `node/install` instead of `node/run`; use `codecov` action [`612862b`](https://github.com/inspect-js/is-generator-function/commit/612862b5fefc2dc1c7e1f5e7478563a5b53f7b23)
- [meta] do not publish github action workflow files [`c13855d`](https://github.com/inspect-js/is-generator-function/commit/c13855dc11947589ed7314840a9cc5ae04db90f4)
- [readme] fix repo URLs; remove travis badge [`bd11a2a`](https://github.com/inspect-js/is-generator-function/commit/bd11a2af1b644cfa352346dcbf6f4cec48b00b78)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `aud`, `tape` [`23f54d4`](https://github.com/inspect-js/is-generator-function/commit/23f54d49da035c1ca79227faee9bacfde2d46884)
- [readme] add actions and codecov badges [`9e759ef`](https://github.com/inspect-js/is-generator-function/commit/9e759ef8e8f098fe1fa3cd9cca98f79f9e8b8b22)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `tape` [`6305f8d`](https://github.com/inspect-js/is-generator-function/commit/6305f8d71ccfa4656bdd280c2616e88fc5ca184b)
- [meta] remove explicit audit level config [`db4391c`](https://github.com/inspect-js/is-generator-function/commit/db4391c68cf8162245d32734685be7c73c2f03c7)
- [meta] use `prepublishOnly` script for npm 7+ [`82c5b18`](https://github.com/inspect-js/is-generator-function/commit/82c5b183a605f1d25af15ec8242c8a8f88a26bfa)
- [Dev Deps] pin `core-js` v3 to &lt; v3.9 [`5f6cc2a`](https://github.com/inspect-js/is-generator-function/commit/5f6cc2ac94a65d7d592775bac6dce573220ccea2)
- [Tests] avoid running harmony tests on node 16+ [`c41526b`](https://github.com/inspect-js/is-generator-function/commit/c41526b8cd1d376f9ca73b56a5ee076db0f9f1c1)
- [actions] update workflows [`a348c5d`](https://github.com/inspect-js/is-generator-function/commit/a348c5d6d4b06041ae0ece9f3765dc13ec9df354)

## [v1.0.8](https://github.com/inspect-js/is-generator-function/compare/v1.0.7...v1.0.8) - 2020-12-02

### Fixed

- [Refactor] improve performance in non-toStringTag envs [`#9`](https://github.com/inspect-js/is-generator-function/issues/9)

### Commits

- [Tests] use shared travis-ci configs [`98c84ec`](https://github.com/inspect-js/is-generator-function/commit/98c84ecd38d7d64b2aa070fa2c240be4373be131)
- [Tests] migrate tests to Github Actions [`52ea2e2`](https://github.com/inspect-js/is-generator-function/commit/52ea2e2e14da2278c7844a18af4aaef1cc8bb3bb)
- [meta] add `auto-changelog` [`a31c8d9`](https://github.com/inspect-js/is-generator-function/commit/a31c8d9e8fe4f397e1f8da5b1297050542cd00c3)
- [Tests] remove `jscs` [`c30694e`](https://github.com/inspect-js/is-generator-function/commit/c30694e5e1739a37c455b8bfae4cc7c4347292de)
- [meta] remove unused Makefile and associated utilities [`23a8dd7`](https://github.com/inspect-js/is-generator-function/commit/23a8dd75ea554642aadb1313c1cbbd11fe69eb1d)
- [Tests] up to `node` `v11.4`, `v10.14`, `v8.14`, `v6.15` [`9711495`](https://github.com/inspect-js/is-generator-function/commit/9711495e58fa9477167d7dbc582749981c3f5ee5)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `tape`, `make-generator-function`; add `safe-publish-latest` [`3afb4d0`](https://github.com/inspect-js/is-generator-function/commit/3afb4d033587eeddfd2dc840ff98c10f3abea48e)
- [Tests] up to `node` `v10.0`, `v9.11`, `v8.11`, `v6.14`, `v4.9` [`f1e9b0f`](https://github.com/inspect-js/is-generator-function/commit/f1e9b0f150e77357ecd4afac5873a3bd3ada7b02)
- [Tests] up to `node` `v11.13`, `v10.15`, `v8.15`, `v6.17` [`433ca64`](https://github.com/inspect-js/is-generator-function/commit/433ca64d5500371516598bebb19fc00370e7c9c7)
- [Tests] run `nyc` on all tests [`84d8e18`](https://github.com/inspect-js/is-generator-function/commit/84d8e18c441c4c181e51a339559040f95adc4d94)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `aud`, `auto-changelog`, `tape` [`ec51a9f`](https://github.com/inspect-js/is-generator-function/commit/ec51a9f2e6f5da5ae5e8b446e0112eeaa0853954)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `replace`, `semver`, `tape` [`180fb0d`](https://github.com/inspect-js/is-generator-function/commit/180fb0dbd1a9d6975344d2deb4338c9071e865b1)
- [actions] add automatic rebasing / merge commit blocking [`7e0f94b`](https://github.com/inspect-js/is-generator-function/commit/7e0f94b055308abc8469e526980991a12a87cfaf)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `covert`, `tape`, `replace`, `semver`, `core-js` [`75768b3`](https://github.com/inspect-js/is-generator-function/commit/75768b30b7d4c92231ed53ec72d2f4ae81274d4c)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `core-js`, `replace`, `semver`, `tape` [`d6413cd`](https://github.com/inspect-js/is-generator-function/commit/d6413cd0bfc27c924619200efe39d9956d6fb638)
- [actions] add "Allow Edits" workflow [`e73fec7`](https://github.com/inspect-js/is-generator-function/commit/e73fec71e5d1c99246a6f905091e133860931245)
- [Dev Deps] update `core-js`, `eslint`, `nsp`, `semver`, `tape` [`6746c73`](https://github.com/inspect-js/is-generator-function/commit/6746c733fa535f724700726356a9156d491b54ae)
- [Tests] switch from `nsp` to `npm audit`; allow it to fail for now [`301aa25`](https://github.com/inspect-js/is-generator-function/commit/301aa2557b4b99962a0e48191c4719c5a95eb69b)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `aud`, `auto-changelog` [`d978937`](https://github.com/inspect-js/is-generator-function/commit/d978937e3c86b3e239e0ceecc2324134806e0a32)
- Revert "[Refactor] improve performance in non-toStringTag envs" [`3892c18`](https://github.com/inspect-js/is-generator-function/commit/3892c18f95a8b5ea57f9893e6d8dce89fec4af30)
- [Tests] test on both core-js 3 and 2 [`fac5447`](https://github.com/inspect-js/is-generator-function/commit/fac54476693d1b8573cbd36bc3c6eb74cbeb7468)
- [Tests] use `npx aud` instead of `npm audit` with hoops [`e12897f`](https://github.com/inspect-js/is-generator-function/commit/e12897feae0185f89592dfe1a02a2a4520180313)
- [meta] add `funding` field [`60711d1`](https://github.com/inspect-js/is-generator-function/commit/60711d122a4ef7ab6a9bee6044a26352ba7f86bd)
- [Fix] `Object.getPrototypeOf` does not exist in all engines [`7484531`](https://github.com/inspect-js/is-generator-function/commit/7484531c55a61fdb7e8d819ce9aa363f29b2c704)
- [Dev Deps] update `auto-changelog`, `tape` [`fe92b74`](https://github.com/inspect-js/is-generator-function/commit/fe92b743baaf206e3ee849c551171f0a56b7fa23)
- [Dev Deps] update `eslint`, `tape` [`2f16f77`](https://github.com/inspect-js/is-generator-function/commit/2f16f77aae4c9aafe65fb29854f46b783d853c58)
- [Dev Deps] update `core-js`, `replace` [`c67825a`](https://github.com/inspect-js/is-generator-function/commit/c67825a62b7bad7911a1bdb5af237d86229aa4bc)
- [Tests] on `node` `v10.1` [`b00dbcc`](https://github.com/inspect-js/is-generator-function/commit/b00dbcce7a9f6df4fb35e99fac79560389a9a272)
- [actions] update rebase action to use checkout v2 [`85c7947`](https://github.com/inspect-js/is-generator-function/commit/85c7947d7474468a5e6dd30b00f632e43f45c21d)
- [actions] switch Automatic Rebase workflow to `pull_request_target` event [`d2fd827`](https://github.com/inspect-js/is-generator-function/commit/d2fd827cf87a90d647d93185f6d5e332fb7b1bb4)
- [Dev Deps] update `@ljharb/eslint-config` [`791766e`](https://github.com/inspect-js/is-generator-function/commit/791766e4f12a96d3b9949128f813dadd428d0891)

## [v1.0.7](https://github.com/inspect-js/is-generator-function/compare/v1.0.6...v1.0.7) - 2017-12-27

### Fixed

- [Tests] run tests with uglify-register [`#16`](https://github.com/inspect-js/is-generator-function/issues/16)
- Exclude `testling.html` from npm package. [`#8`](https://github.com/inspect-js/is-generator-function/issues/8)

### Commits

- [Tests] up to `node` `v8.4`; use `nvm install-latest-npm` to ensure new npm doesnâ€™t break old node; remove osx builds [`365004b`](https://github.com/inspect-js/is-generator-function/commit/365004b20b302dceb7bd2cee91814f0a55ae3253)
- [Tests] up to `node` `v9.2`, `v8.9`, `v6.12`; pin included builds to LTS [`33916ea`](https://github.com/inspect-js/is-generator-function/commit/33916eadddccf2a39c8cf0160f82c9a5d4a20ecb)
- [Dev Deps] update `core-js`, `eslint`, `nsp` [`b4ce014`](https://github.com/inspect-js/is-generator-function/commit/b4ce0144a8b56fc3089b96f1b8818c6e793e552f)
- [Dev Deps] update `eslint`, `@ljharb/eslint-config`, `core-js`, `nsp`, `semver`, `tape` [`e4b499f`](https://github.com/inspect-js/is-generator-function/commit/e4b499fbe2e5e24593eb25bd63dfc2a1520aaa04)
- [Tests] up to `node` `v7.4`, `v4.7` [`ce642b6`](https://github.com/inspect-js/is-generator-function/commit/ce642b63f0f9c4f56ca3daefbf8b0d4cbda8c0a4)
- Only apps should have lockfiles. [`ea4dfb1`](https://github.com/inspect-js/is-generator-function/commit/ea4dfb15554de3a22656415cda985ceaf449be00)
- [Tests] on `node` `v9.3` [`307d9c1`](https://github.com/inspect-js/is-generator-function/commit/307d9c144fed8a4aec412d3e9ccc117d1c08e167)
- fix: example code missing ) after argument list [`05f62c7`](https://github.com/inspect-js/is-generator-function/commit/05f62c712a9ca08b0efcabe883affd7c0734f51c)
- [Tests] update `uglify-register` [`7376bec`](https://github.com/inspect-js/is-generator-function/commit/7376bec6c3c8ee16cf16feb285798be23e6c2c89)
- [Dev Deps] update `eslint` [`c3f5895`](https://github.com/inspect-js/is-generator-function/commit/c3f58952033c93918aa5b5ac527520b26c2460f8)

## [v1.0.6](https://github.com/inspect-js/is-generator-function/compare/v1.0.5...v1.0.6) - 2016-12-20

### Fixed

- [Fix] fix `is-generator-function` in an env without native generators, with core-js. [`#33`](https://github.com/ljharb/is-equal/issues/33)

### Commits

- [Tests] fix linting errors. [`9d12cdb`](https://github.com/inspect-js/is-generator-function/commit/9d12cdb4bb43c63801173635a7db92ced8f720d8)

## [v1.0.5](https://github.com/inspect-js/is-generator-function/compare/v1.0.4...v1.0.5) - 2016-12-19

### Commits

- Update `tape`, `semver`, `eslint`; use my personal shared `eslint` config. [`3a1192c`](https://github.com/inspect-js/is-generator-function/commit/3a1192cbf25ee5a1ca64e64c20d169c643ceb860)
- Add `npm run eslint` [`ae191b6`](https://github.com/inspect-js/is-generator-function/commit/ae191b61d3ec65de63bcd7b2c1ab08f2f9a94ead)
- [Tests] improve test matrix [`0d0837f`](https://github.com/inspect-js/is-generator-function/commit/0d0837fe00bed00ced94ef5a7bfdbd7e8e295656)
- [Dev Deps] update `tape`, `jscs`, `eslint`, `@ljharb/eslint-config`, `semver`, `nsp` [`6523655`](https://github.com/inspect-js/is-generator-function/commit/652365556b5f8eea69b4612a183b5026c952e776)
- Update `jscs`, `tape`, `semver` [`c185388`](https://github.com/inspect-js/is-generator-function/commit/c185388111ee6c0df1498a76d9c565167b5d20cd)
- Update `eslint` [`9959dbc`](https://github.com/inspect-js/is-generator-function/commit/9959dbc1450214658dc4789574b68de826ec33a7)
- Update `tape`, `jscs`, `eslint`, `@ljharb/eslint-config` [`5945497`](https://github.com/inspect-js/is-generator-function/commit/5945497bc564655ed5ea1bb6f12610a9afc33a33)
- [Dev Deps] update `tape`, `jscs`, `eslint`, `@ljharb/eslint-config` [`1754eae`](https://github.com/inspect-js/is-generator-function/commit/1754eaec79e43835bd154c81fba064b558f7ad1b)
- Update `eslint`, `semver`, `nsp` [`a40f7af`](https://github.com/inspect-js/is-generator-function/commit/a40f7afab3f6ba43193e5464faf51692f6f2199d)
- Update `covert`, `jscs`, `eslint`, `semver` [`f7c3504`](https://github.com/inspect-js/is-generator-function/commit/f7c35049406adc784b23b6b0fbfdd34b4ca8c183)
- [Fix] account for Safari 10 which reports the wrong toString on generator functions. [`3a3a52b`](https://github.com/inspect-js/is-generator-function/commit/3a3a52bdba46e03ae333af9519bf471207bf6cec)
- [Dev Deps] update `tape`, `jscs`, `eslint`, `@ljharb/eslint-config`, `semver`, `nsp` [`aaab6c3`](https://github.com/inspect-js/is-generator-function/commit/aaab6c3a331c8c8793f8f43aa1d452cc12b92c0d)
- [Dev Deps] update `jscs` [`e24641c`](https://github.com/inspect-js/is-generator-function/commit/e24641ca69ae3ee232837e9153c8b43b046cfe69)
- [Tests] up to `io.js` `v3.3`, `node` `v4.1` [`c43c5ad`](https://github.com/inspect-js/is-generator-function/commit/c43c5ade8b3b62fa27fac3e5104ab3df93278878)
- Add `npm run security` via `nsp` [`24256ca`](https://github.com/inspect-js/is-generator-function/commit/24256ca5f5308930e86c3dc75b70bbfe1033e9b6)
- Test up to `io.js` `v2.3` [`730233f`](https://github.com/inspect-js/is-generator-function/commit/730233f0ca376887c698c01799b60ee54424bf9f)
- [Tests] use pretest/posttest for linting/security/**
 * @fileoverview Types for object-schema package.
 */

/**
 * Built-in validation strategies.
 */
export type BuiltInValidationStrategy =
	| "array"
	| "boolean"
	| "number"
	| "object"
	| "object?"
	| "string"
	| "string!";

/**
 * Built-in merge strategies.
 */
export type BuiltInMergeStrategy = "assign" | "overwrite" | "replace";

/**
 * Property definition.
 */
export interface PropertyDefinition {
	/**
	 * Indicates if the property is required.
	 */
	required: boolean;

	/**
	 * The other properties that must be present when this property is used.
	 */
	requires?: string[];

	/**
	 * The strategy to merge the property.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- https://github.com/eslint/rewrite/pull/90#discussion_r1687206213
	merge: BuiltInMergeStrategy | ((target: any, source: any) => any);

	/**
	 * The strategy to validate the property.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- https://github.com/eslint/rewrite/pull/90#discussion_r1687206213
	validate: BuiltInValidationStrategy | ((value: any) => void);

	/**
	 * The schema for the object value of this property.
	 */
	schema?: ObjectDefinition;
}

/**
 * Object definition.
 */
export type ObjectDefinition = Record<string, PropertyDefinition>;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             ting the current Punycode.js version number.
  * @memberOf punycode
  * @type String
  */
	'version': '2.1.0',
	/**
  * An object of methods to convert from JavaScript's internal character
  * representation (UCS-2) to Unicode code points, and back.
  * @see <https://mathiasbynens.be/notes/javascript-encoding>
  * @memberOf punycode
  * @type Object
  */
	'ucs2': {
		'decode': ucs2decode,
		'encode': ucs2encode
	},
	'decode': decode,
	'encode': encode,
	'toASCII': toASCII,
	'toUnicode': toUnicode
};

/**
 * URI.js
 *
 * @fileoverview An RFC 3986 compliant, scheme extendable URI parsing/validating/resolving library for JavaScript.
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @see http://github.com/garycourt/uri-js
 */
/**
 * Copyright 2011 Gary Court. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are
 * permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice, this list of
 *       conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice, this list
 *       of conditions and the following disclaimer in the documentation and/or other materials
 *       provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GARY COURT ``AS IS'' AND ANY EXPRESS OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GARY COURT OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
 * ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The views and conclusions contained in the software and documentation are those of the
 * authors and should not be interpreted as representing official policies, either expressed
 * or implied, of Gary Court.
 */
var SCHEMES = {};
function pctEncChar(chr) {
    var c = chr.charCodeAt(0);
    var e = void 0;
    if (c < 16) e = "%0" + c.toString(16).toUpperCase();else if (c < 128) e = "%" + c.toString(16).toUpperCase();else if (c < 2048) e = "%" + (c >> 6 | 192).toString(16).toUpperCase() + "%" + (c & 63 | 128).toString(16).toUpperCase();else e = "%" + (c >> 12 | 224).toString(16).toUpperCase() + "%" + (c >> 6 & 63 | 128).toString(16).toUpperCase() + "%" + (c & 63 | 128).toString(16).toUpperCase();
    return e;
}
function pctDecChars(str) {
    var newStr = "";
    var i = 0;
    var il = str.length;
    while (i < il) {
        var c = parseInt(str.substr(i + 1, 2), 16);
        if (c < 128) {
            newStr += String.fromCharCode(c);
            i += 3;
        } else if (c >= 194 && c < 224) {
            if (il - i >= 6) {
                var c2 = parseInt(str.substr(i + 4, 2), 16);
                newStr += String.fromCharCode((c & 31) << 6 | c2 & 63);
            } else {
                newStr += str.substr(i, 6);
            }
            i += 6;
        } else if (c >= 224) {
            if (il - i >= 9) {
                var _c = parseInt(str.substr(i + 4, 2), 16);
                var c3 = parseInt(str.substr(i + 7, 2), 16);
                newStr += String.fromCharCode((c & 15) << 12 | (_c & 63) << 6 | c3 & 63);
            } else {
                newStr += str.substr(i, 9);
            }
            i += 9;
        } else {
            newStr += str.substr(i, 3);
            i += 3;
        }
    }
    return newStr;
}
function _normalizeComponentEncoding(components, protocol) {
    function decodeUnreserved(str) {
        var decStr = pctDecChars(str);
        return !decStr.match(protocol.UNRESERVED) ? str : decStr;
    }
    if (components.scheme) components.scheme = String(components.scheme).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_SCHEME, "");
    if (components.userinfo !== undefined) components.userinfo = String(components.userinfo).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_USERINFO, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.host !== undefined) components.host = String(components.host).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_HOST, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.path !== undefined) components.path = String(components.path).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(components.scheme ? protocol.NOT_PATH : protocol.NOT_PATH_NOSCHEME, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.query !== undefined) components.query = String(components.query).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_QUERY, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.fragment !== undefined) components.fragment = String(components.fragment).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_FRAGMENT, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    return components;
}

function _stripLeadingZeros(str) {
    return str.replace(/^0*(.*)/, "$1") || "0";
}
function _normalizeIPv4(host, protocol) {
    var matches = host.match(protocol.IPV4ADDRESS) || [];

    var _matches = slicedToArray(matches, 2),
        address = _matches[1];

    if (address) {
        return address.split(".").map(_stripLeadingZeros).join(".");
    } else {
        return host;
    }
}
function _normalizeIPv6(host, protocol) {
    var matches = host.match(protocol.IPV6ADDRESS) || [];

    var _matches2 = slicedToArray(matches, 3),
        address = _matches2[1],
        zone = _matches2[2];

    if (address) {
        var _address$toLowerCase$ = address.toLowerCase().split('::').reverse(),
            _address$toLowerCase$2 = slicedToArray(_address$toLowerCase$, 2),
            last = _address$toLowerCase$2[0],
            first = _address$toLowerCase$2[1];

        var firstFields = first ? first.split(":").map(_stripLeadingZeros) : [];
        var lastFields = last.split(":").map(_stripLeadingZeros);
        var isLastFieldIPv4Address = protocol.IPV4ADDRESS.test(lastFields[lastFields.length - 1]);
        var fieldCount = isLastFieldIPv4Address ? 7 : 8;
        var lastFieldsStart = lastFields.length - fieldCount;
        var fields = Array(fieldCount);
        for (var x = 0; x < fieldCount; ++x) {
            fields[x] = firstFields[x] || lastFields[lastFieldsStart + x] || '';
        }
        if (isLastFieldIPv4Address) {
            fields[fieldCount - 1] = _normalizeIPv4(fields[fieldCount - 1], protocol);
        }
        var allZeroFields = fields.reduce(function (acc, field, index) {
            if (!field || field === "0") {
                var lastLongest = acc[acc.length - 1];
                if (lastLongest && lastLongest.index + lastLongest.length === index) {
                    lastLongest.length++;
                } else {
                    acc.push({ index: index, length: 1 });
                }
            }
            return acc;
        }, []);
        var longestZeroFields = allZeroFields.sort(function (a, b) {
            return b.length - a.length;
        })[0];
        var newHost = void 0;
        if (longestZeroFields && longestZeroFields.length > 1) {
            var newFirst = fields.slice(0, longestZeroFields.index);
            var newLast = fields.slice(longestZeroFields.index + longestZeroFields.length);
            newHost = newFirst.join(":") + "::" + newLast.join(":");
        } else {
            newHost = fields.join(":");
        }
        if (zone) {
            newHost += "%" + zone;
        }
        return newHost;
    } else {
        return host;
    }
}
var URI_PARSE = /^(?:([^:\/?#]+):)?(?:\/\/((?:([^\/?#@]*)@)?(\[[^\/?#\]]+\]|[^\/?#:]*)(?:\:(\d*))?))?([^?#]*)(?:\?([^#]*))?(?:#((?:.|\n|\r)*))?/i;
var NO_MATCH_IS_UNDEFINED = "".match(/(){0}/)[1] === undefined;
function parse(uriString) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var components = {};
    var protocol = options.iri !== false ? IRI_PROTOCOL : URI_PROTOCOL;
    if (options.reference === "suffix") uriString = (options.scheme ? options.scheme + ":" : "") + "//" + uriString;
    var matches = uriString.match(URI_PARSE);
    if (matches) {
        if (NO_MATCH_IS_UNDEFINED) {
            //store each component
            components.scheme = matches[1];
            components.userinfo = matches[3];
            components.host = matches[4];
            components.port = parseInt(matches[5], 10);
            components.path = matches[6] || "";
            components.query = matches[7];
            components.fragment = matches[8];
            //fix port number
            if (isNaN(components.port)) {
                components.port = matches[5];
            }
        } else {
            //IE FIX for improper RegExp matching
            //store each component
            components.scheme = matches[1] || undefined;
            components.userinfo = uriString.indexOf("@") !== -1 ? matches[3] : undefined;
            components.host = uriString.indexOf("//") !== -1 ? matches[4] : undefined;
            components.port = parseInt(matches[5], 10);
            components.path = matches[6] || "";
            components.query = uriString.indexOf("?") !== -1 ? matches[7] : undefined;
            components.fragment = uriString.indexOf("#") !== -1 ? matches[8] : undefined;
            //fix port number
            if (isNaN(components.port)) {
                components.port = uriString.match(/\/\/(?:.|\n)*\:(?:\/|\?|\#|$)/) ? matches[4] : undefined;
            }
        }
        if (components.host) {
            //normalize IP hosts
            components.host = _normalizeIPv6(_normalizeIPv4(components.host, protocol), protocol);
        }
        //determine reference type
        if (components.scheme === undefined && components.userinfo === undefined && components.host === undefined && components.port === undefined && !components.path && components.query === undefined) {
            components.reference = "same-document";
        } else if (components.scheme === undefined) {
            components.reference = "relative";
        } else if (components.fragment === undefined) {
            components.reference = "absolute";
        } else {
            components.reference = "uri";
        }
        //check for reference errors
        if (options.reference && options.reference !== "suffix" && options.reference !== components.reference) {
            components.error = components.error || "URI is not a " + options.reference + " reference.";
        }
        //find scheme handler
        var schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
        //check if scheme can't handle IRIs
        if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
            //if host component is a domain name
            if (components.host && (options.domainHost || schemeHandler && schemeHandler.domainHost)) {
                //convert Unicode IDN -> ASCII IDN
                try {
                    components.host = punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase());
                } catch (e) {
                    components.error = components.error || "Host's domain name can not be converted to ASCII via punycode: " + e;
                }
            }
            //convert IRI -> URI
            _normalizeComponentEncoding(components, URI_PROTOCOL);
        } else {
            //normalize encodings
            _normalizeComponentEncoding(components, protocol);
        }
        //perform scheme specific parsing
        if (schemeHandler && schemeHandler.parse) {
            schemeHandler.parse(components, options);
        }
    } else {
        components.error = components.error || "URI can not be parsed.";
    }
    return components;
}

function _recomposeAuthority(components, options) {
    var protocol = options.iri !== false ? IRI_PROTOCOL : URI_PROTOCOL;
    var uriTokens = [];
    if (components.userinfo !== undefined) {
        uriTokens.push(components.userinfo);
        uriTokens.push("@");
    }
    if (components.host !== undefined) {
        //normalize IP hosts, add brackets and escape zone separator for IPv6
        uriTokens.push(_normalizeIPv6(_normalizeIPv4(String(components.host), protocol), protocol).replace(protocol.IPV6ADDRESS, function (_, $1, $2) {
            return "[" + $1 + ($2 ? "%25" + $2 : "") + "]";
        }));
    }
    if (typeof components.port === "number" || typeof components.port === "string") {
        uriTokens.push(":");
        uriTokens.push(String(components.port));
    }
    return uriTokens.length ? uriTokens.join("") : undefined;
}

var RDS1 = /^\.\.?\//;
var RDS2 = /^\/\.(\/|$)/;
var RDS3 = /^\/\.\.(\/|$)/;
var RDS5 = /^\/?(?:.|\n)*?(?=\/|$)/;
function removeDotSegments(input) {
    var output = [];
    while (input.length) {
        if (input.match(RDS1)) {
            input = input.replace(RDS1, "");
        } else if (input.match(RDS2)) {
            input = input.replace(RDS2, "/");
        } else if (input.match(RDS3)) {
            input = input.replace(RDS3, "/");
            output.pop();
        } else if (input === "." || input === "..") {
            input = "";
        } else {
            var im = input.match(RDS5);
            if (im) {
                var s = im[0];
                input = input.slice(s.length);
                output.push(s);
            } else {
                throw new Error("Unexpected dot segment condition");
            }
        }
    }
    return output.join("");
}

function serialize(components) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var protocol = options.iri ? IRI_PROTOCOL : URI_PROTOCOL;
    var uriTokens = [];
    //find scheme handler
    var schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
    //perform scheme specific serialization
    if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(components, options);
    if (components.host) {
        //if host component is an IPv6 address
        if (protocol.IPV6ADDRESS.test(components.host)) {}
        //TODO: normalize IPv6 address as per RFC 5952

        //if host component is a domain name
        else if (options.domainHost || schemeHandler && schemeHandler.domainHost) {
                //convert IDN via punycode
                try {
                    components.host = !options.iri ? punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase()) : punycode.toUnicode(components.host);
                } catch (e) {
                    components.error = components.error || "Host's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
                }
            }
    }
    //normalize encoding
    _normalizeComponentEncoding(components, protocol);
    if (options.reference !== "suffix" && components.scheme) {
        uriTokens.push(components.scheme);
        uriTokens.push(":");
    }
    var authority = _recomposeAuthority(components, options);
    if (authority !== undefined) {
        if (options.reference !== "suffix") {
            uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (components.path && components.path.charAt(0) !== "/") {
            uriTokens.push("/");
        }
    }
    if (components.path !== undefined) {
        var s = components.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
            s = removeDotSegments(s);
        }
        if (authority === undefined) {
            s = s.replace(/^\/\//, "/%2F"); //don't allow the path to start with "//"
        }
        uriTokens.push(s);
    }
    if (components.query !== undefined) {
        uriTokens.push("?");
     'use strict';

require('../auto');

var test = require('tape');
var defineProperties = require('define-properties');

var isEnumerable = Object.prototype.propertyIsEnumerable;
var functionsHaveNames = require('functions-have-names')();

var runTests = require('./tests');

test('shimmed', function (t) {
	t.equal(Reflect.getPrototypeOf.length, 1, 'Reflect.getPrototypeOf has length of 1');
	t.test('Function name', { skip: !functionsHaveNames }, function (st) {
		st.equal(Reflect.getPrototypeOf.name, 'getPrototypeOf', 'Reflect.getPrototypeOf has name "getPrototypeOf"');
		st.end();
	});

	t.test('enumerability', { skip: !defineProperties.supportsDescriptors }, function (et) {
		et.equal(false, isEnumerable.call(Reflect, 'getPrototypeOf'), 'Reflect.getPrototypeOf is not enumerable');
		et.end();
	});

	runTests(Reflect.getPrototypeOf, t);

	t.end();
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   /**
 * Escape all magic characters in a glob pattern.
 *
 * If the {@link windowsPathsNoEscape | GlobOptions.windowsPathsNoEscape}
 * option is used, then characters are escaped by wrapping in `[]`, because
 * a magic character wrapped in a character class can only be satisfied by
 * that exact character.  In this mode, `\` is _not_ escaped, because it is
 * not interpreted as a magic character, but instead as a path separator.
 */
export const escape = (s, { windowsPathsNoEscape = false, } = {}) => {
    // don't need to escape +@! because we escape the parens
    // that make those magic, and escaping ! as [!] isn't valid,
    // because [!]] is a valid glob class meaning not ']'.
    return windowsPathsNoEscape
        ? s.replace(/[?*()[\]]/g, '[$&]')
        : s.replace(/[?*()[\]\\]/g, '\\$&');
};
//# sourceMappingURL=escape.js.map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                INDX( 	 %`            (   X  è       ÛÛ                  sE    h X     ±D    ö¸Æ‚eÛù…Æ‚eÛù…Æ‚eÛù…Æ‚eÛ¨      £               a l l _ b o o l . j s gF    ` P     ±D    	WÆ‚eÛLR"Æ‚eÛLR"Æ‚eÛLR"Æ‚eÛ       ÷               b o o l . j s 5G    ` P     ±D    ï“*Æ‚eÛRŒ,Æ‚eÛRŒ,Æ‚eÛRŒ,Æ‚eÛ       Ý               d a s h . j s ýG    p `     ±D    ª„0Æ‚eÛßË1Æ‚eÛßË1Æ‚eÛßË1Æ‚eÛ       É               d e f a u l t _ b o o l . j s ¸H    h T     ±D    ÷t6Æ‚eÛãQ9Æ‚e ãQ9Æ‚eÛãQ9Æ‚eÛP      J              	 d o t t e d . j s     <J    h X     ±D    ½ØEÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛ˜      ”               k v _ s h o r t . j s ÕJ    ` P     ±D    PÓJÆ‚eÛPÓJÆ‚eÛPÓJÆ‚eÛPÓJÆ‚eÛ      ‰               l o n g . j s bK    ` N     ±D    nGNÆ‚eÛnGNÆ‚eÛnGNÆ‚eÛnGNÆ‚eÛ                      n u m . j s   tL    h R     ±D    iÿWÆ‚eÛ 5YÆ‚eÛ 5YÆ‚eÛ 5YÆ‚eÛ       ö               p a r s e . j s d i f ÁK    x d     ±D    ÒQÆ‚eÛWRÆ‚eÛWRÆ‚e WRÆ‚eÛð       í                p a r s e _ m o d i f i e d . j s     ÍL    h R     ±D    ¨¸[Æ‚eÛçd\Æ‚eÛçd\Æ‚eÛçd\Æ‚eÛ       Í               p r o t o . j s       M    h R     ±D    `®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛ                      s h o r t . j s       8M    p \     ±D    —;_Æ‚eÛ—;_Æ‚eÛ—;_Æ‚eÛ—;_Æ‚eÛ8      8               s t o p _ e a r l y . j s     ^M    h V     ±D    ª1`Æ‚eÛª1`Æ‚eÛª1`Æ‚eÛª1`Æ‚eÛ       :              
 u n k n o w n . j s   ƒM    p \    ±D    ì¦aÆ‚eÛ ÓaÆ‚eÛ ÓaÆ‚eÛ ÓaÆ‚eÛÈ       Â                w h i t e s p a c e . j s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              # Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.0.1](https://github.com/es-shims/dunder-proto/compare/v1.0.0...v1.0.1) - 2024-12-16

### Commits

- [Fix] do not crash when `--disable-proto=throw` [`6c367d9`](https://github.com/es-shims/dunder-proto/commit/6c367d919bc1604778689a297bbdbfea65752847)
- [Tests] ensure noproto tests only use the current version of dunder-proto [`b02365b`](https://github.com/es-shims/dunder-proto/commit/b02365b9cf889c4a2cac7be0c3cfc90a789af36c)
- [Dev Deps] update `@arethetypeswrong/cli`, `@types/tape` [`e3c5c3b`](https://github.com/es-shims/dunder-proto/commit/e3c5c3bd81cf8cef7dff2eca19e558f0e307f666)
- [Deps] update `call-bind-apply-helpers` [`19f1da0`](https://github.com/es-shims/dunder-proto/commit/19f1da028b8dd0d05c85bfd8f7eed2819b686450)

## v1.0.0 - 2024-12-06

### Commits

- Initial implementation, tests, readme, types [`a5b74b0`](https://github.com/es-shims/dunder-proto/commit/a5b74b0082f5270cb0905cd9a2e533cee7498373)
- Initial commit [`73fb5a3`](https://github.com/es-shims/dunder-proto/commit/73fb5a353b51ac2ab00c9fdeb0114daffd4c07a8)
- npm init [`80152dc`](https://github.com/es-shims/dunder-proto/commit/80152dc98155da4eb046d9f67a87ed96e8280a1d)
- Only apps should have lockfiles [`03e6660`](https://github.com/es-shims/dunder-proto/commit/03e6660a1d70dc401f3e217a031475ec537243dd)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     gContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _loadExtends(extendName, ctx) {
        debug("Loading {extends:%j} relative to %s", extendName, ctx.filePath);
        try {
            if (extendName.startsWith("eslint:")) {
                return this._loadExtendedBuiltInConfig(extendName, ctx);
            }
            if (extendName.startsWith("plugin:")) {
                return this._loadExtendedPluginConfig(extendName, ctx);
            }
            return this._loadExtendedShareableConfig(extendName, ctx);
        } catch (error) {
            error.message += `\nReferenced from: ${ctx.filePath || ctx.name}`;
            throw error;
        }
    }

    /**
     * Load configs of an element in `extends`.
     * @param {string} extendName The name of a base config.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _loadExtendedBuiltInConfig(extendName, ctx) {
        const {
            eslintAllPath,
            getEslintAllConfig,
            eslintRecommendedPath,
            getEslintRecommendedConfig
        } = internalSlotsMap.get(this);

        if (extendName === "eslint:recommended") {
            const name = `${ctx.name} Â» ${extendName}`;

            if (getEslintRecommendedConfig) {
                if (typeof getEslintRecommendedConfig !== "function") {
                    throw new Error(`getEslintRecommendedConfig must be a function instead of '${getEslintRecommendedConfig}'`);
                }
                return this._normalizeConfigData(getEslintRecommendedConfig(), { ...ctx, name, filePath: "" });
            }
            return this._loadConfigData({
                ...ctx,
                name,
                filePath: eslintRecommendedPath
            });
        }
        if (extendName === "eslint:all") {
            const name = `${ctx.name} Â» ${extendName}`;

            if (getEslintAllConfig) {
                if (typeof getEslintAllConfig !== "function") {
                    throw new Error(`getEslintAllConfig must be a function instead of '${getEslintAllConfig}'`);
                }
                return this._normalizeConfigData(getEslintAllConfig(), { ...ctx, name, filePath: "" });
            }
            return this._loadConfigData({
                ...ctx,
                name,
                filePath: eslintAllPath
            });
        }

        throw configInvalidError(extendName, ctx.name, "extend-config-missing");
    }

    /**
     * Load configs of an element in `extends`.
     * @param {string} extendName The name of a base config.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _loadExtendedPluginConfig(extendName, ctx) {
        const slashIndex = extendName.lastIndexOf("/");

        if (slashIndex === -1) {
            throw configInvalidError(extendName, ctx.filePath, "plugin-invalid");
        }

        const pluginName = extendName.slice("plugin:".length, slashIndex);
        const configName = extendName.slice(slashIndex + 1);

        if (isFilePath(pluginName)) {
            throw new Error("'extends' cannot use a file path for plugins.");
        }

        const plugin = this._loadPlugin(pluginName, ctx);
        const configData =
            plugin.definition &&
            plugin.definition.configs[configName];

        if (configData) {
            return this._normalizeConfigData(configData, {
                ...ctx,
                filePath: plugin.filePath || ctx.filePath,
                name: `${ctx.name} Â» plugin:${plugin.id}/${configName}`
            });
        }

        throw plugin.error || configInvalidError(extendName, ctx.filePath, "extend-config-missing");
    }

    /**
     * Load configs of an element in `extends`.
     * @param {string} extendName The name of a base config.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _loadExtendedShareableConfig(extendName, ctx) {
        const { cwd, resolver } = internalSlotsMap.get(this);
        const relativeTo = ctx.filePath || path.join(cwd, "__placeholder__.js");
        let request;

        if (isFilePath(extendName)) {
            request = extendName;
        } else if (extendName.startsWith(".")) {
            request = `./${extendName}`; // For backward compatibility. A ton of tests depended on this behavior.
        } else {
            request = naming.normalizePackageName(
                extendName,
                "eslint-config"
            );
        }

        let filePath;

        try {
            filePath = resolver.resolve(request, relativeTo);
        } catch (error) {
            /* istanbul ignore else */
            if (error && error.code === "MODULE_NOT_FOUND") {
                throw configInvalidError(extendName, ctx.filePath, "extend-config-missing");
            }
            throw error;
        }

        writeDebugLogForLoading(request, relativeTo, filePath);
        return this._loadConfigData({
            ...ctx,
            filePath,
            name: `${ctx.name} Â» ${request}`
        });
    }

    /**
     * Load given plugins.
     * @param {string[]} names The plugin names to load.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {Record<string,DependentPlugin>} The loaded parser.
     * @private
     */
    _loadPlugins(names, ctx) {
        return names.reduce((map, name) => {
            if (isFilePath(name)) {
                throw new Error("Plugins array cannot includes file paths.");
            }
            const plugin = this._loadPlugin(name, ctx);

            map[plugin.id] = plugin;

            return map;
        }, {});
    }

    /**
     * Load a given parser.
     * @param {string} nameOrPath The package name or the path to a parser file.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {DependentParser} The loaded parser.
     */
    _loadParser(nameOrPath, ctx) {
        debug("Loading parser %j from %s", nameOrPath, ctx.filePath);

        const { cwd, resolver } = internalSlotsMap.get(this);
        const relativeTo = ctx.filePath || path.join(cwd, "__placeholder__.js");

        try {
            const filePath = resolver.resolve(nameOrPath, relativeTo);

            writeDebugLogForLoading(nameOrPath, relativeTo, filePath);

            return new ConfigDependency({
                definition: require(filePath),
                filePath,
                id: nameOrPath,
                importerName: ctx.name,
                importerPath: ctx.filePath
            });
        } catch (error) {

            // If the parser name is "espree", load the espree of ESLint.
            if (nameOrPath === "espree") {
                debug("Fallback espree.");
                return new ConfigDependency({
                    definition: require("espree"),
                    filePath: require.resolve("espree"),
                    id: nameOrPath,
                    importerName: ctx.name,
                    importerPath: ctx.filePath
                });
            }

            debug("Failed to load parser '%s' declared in '%s'.", nameOrPath, ctx.name);
            error.message = `Failed to load parser '${nameOrPath}' declared in '${ctx.name}': ${error.message}`;

            return new ConfigDependency({
                error,
                id: nameOrPath,
                importerName: ctx.name,
                importerPath: ctx.filePath
            });
        }
    }

    /**
     * Load a given plugin.
     * @param {string} name The plugin name to load.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {DependentPlugin} The loaded plugin.
     * @private
     */
    _loadPlugin(name, ctx) {
        debug("Loading plugin %j from %s", name, ctx.filePath);

        const { additionalPluginPool, resolver } = internalSlotsMap.get(this);
        const request = naming.normalizePackageName(name, "eslint-plugin");
        const id = naming.getShorthandName(request, "eslint-plugin");
        const relativeTo = path.join(ctx.pluginBasePath, "__placeholder__.js");

        if (name.match(/\s+/u)) {
            const error = Object.assign(
                new Error(`Whitespace found in plugin name '${name}'`),
                {
                    messageTemplate: "whitespace-found",
                    messageData: { pluginName: request }
                }
            );

            return new ConfigDependency({
                error,
                id,
                importerName: ctx.name,
                importerPath: ctx.filePath
            });
        }

        // Check for additional pool.
        const plugin =
            additionalPluginPool.get(request) ||
            additionalPluginPool.get(id);

        if (plugin) {
            return new ConfigDependency({
                definition: normalizePlugin(plugin),
                original: plugin,
                filePath: "", // It's unknown where the plugin came from.
                id,
                importerName: ctx.name,
                importerPath: ctx.filePath
            });
        }

        let filePath;
        let error;

        try {
            filePath = resolver.resolve(request, relativeTo);
        } catch (resolveError) {
            error = resolveError;
            /* istanbul ignore else */
            if (error && error.code === "MODULE_NOT_FOUND") {
                error.messageTemplate = "plugin-missing";
                error.messageData = {
                    pluginName: request,
                    resolvePluginsRelativeTo: ctx.pluginBasePath,
                    importerName: ctx.name
                };
            }
        }

        if (filePath) {
            try {
                writeDebugLogForLoading(request, relativeTo, filePath);

                const startTime = Date.now();
                const pluginDefinition = require(filePath);

                debug(`Plugin ${filePath} loaded in: ${Date.now() - startTime}ms`);

                return new ConfigDependency({
                    definition: normalizePlugin(pluginDefinition),
                    original: pluginDefinition,
                    filePath,
                    id,
                    importerName: ctx.name,
                    importerPath: ctx.filePath
                });
            } catch (loadError) {
                error = loadError;
            }
        }

        debug("Failed to load plugin '%s' declared in '%s'.", name, ctx.name);
        error.message = `Failed to load plugin '${name}' declared in '${ctx.name}': ${error.message}`;
        return new ConfigDependency({
            error,
            id,
            importerName: ctx.name,
            importerPath: ctx.filePath
        });
    }

    /**
     * Take file expression processors as config array elements.
     * @param {Record<string,DependentPlugin>} plugins The plugin definitions.
     * @param {ConfigArrayFactoryLoadingContext} ctx The loading context.
     * @returns {IterableIterator<ConfigArrayElement>} The config array elements of file expression processors.
     * @private
     */
    *_takeFileExtensionProcessors(plugins, ctx) {
        for (const pluginId of Object.keys(plugins)) {
            const processors =
                plugins[pluginId] &&
                plugins[pluginId].definition &&
                plugins[pluginId].definition.processors;

            if (!processors) {
                continue;
            }

            for (const processorId of Object.keys(processors)) {
                if (processorId.startsWith(".")) {
                    yield* this._normalizeObjectConfigData(
                        {
                            files: [`*${processorId}`],
                            processor: `${pluginId}/${processorId}`
                        },
                        {
                            ...ctx,
                            type: "implicit-processor",
                            name: `${ctx.name}#processors["${pluginId}/${processorId}"]`
                        }
                    );
                }
            }
        }
    }
}

export {
    ConfigArrayFactory,
    createContext,
    loadConfigFile
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        'use strict';

require('../auto');

var test = require('tape');
var defineProperties = require('define-properties');
var callBind = require('call-bind');
var hasStrictMode = require('has-strict-mode')();
var functionsHaveNames = require('functions-have-names')();

var isEnumerable = Object.prototype.propertyIsEnumerable;

var runTests = require('./tests');

test('shimmed', function (t) {
	var fn = Array.prototype.toSorted;
	t.equal(fn.length, 1, 'Array#toSorted has a length of 1');
	t.test('Function name', { skip: !functionsHaveNames }, function (st) {
		st.equal(fn.name, 'toSorted', 'Array#toSorted has name "toSorted"');
		st.end();
	});

	t.test('enumerability', { skip: !defineProperties.supportsDescriptors }, function (et) {
		et.equal(false, isEnumerable.call(Array.prototype, 'toSorted'), 'Array#toSorted is not enumerable');
		et.end();
	});

	t.test('bad array/this value', { skip: !hasStrictMode }, function (st) {
		/* eslint no-useless-call: 0 */
		st['throws'](function () { return fn.call(undefined); }, TypeError, 'undefined is not an object');
		st['throws'](function () { return fn.call(null); }, TypeError, 'null is not an object');
		st.end();
	});

	runTests(callBind(fn), t);

	t.end();
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             The end index in the source code. Default is `source.length`.
    - `flags?` (`{ unicode?: boolean, unicodeSets?: boolean }`) The flags to enable Unicode mode, and Unicode Set mode.

#### validator.validateFlags(source, start, end)

Validate a regular expression flags.

- **Parameters:**
    - `source` (`string`) The source code to validate.
    - `start?` (`number`) The start index in the source code. Default is `0`.
    - `end?` (`number`) The end index in the source code. Default is `source.length`.

### RegExpVisitor

#### new RegExpVisitor(handlers)

- **Parameters:**
    - `handlers` ([`RegExpVisitor.Handlers`]) The callbacks.

#### visitor.visit(ast)

Validate a regular expression literal.

- **Parameters:**
    - `ast` ([`AST.Node`]) The AST to visit.

## ðŸ“° Changelog

- [GitHub Releases](https://github.com/eslint-community/regexpp/releases)

## ðŸ» Contributing

Welcome contributing!

Please use GitHub's Issues/PRs.

### Development Tools

- `npm test` runs tests and measures coverage.
- `npm run build` compiles TypeScript source code to `index.js`, `index.js.map`, and `index.d.ts`.
- `npm run clean` removes the temporary files which are created by `npm test` and `npm run build`.
- `npm run lint` runs ESLint.
- `npm run update:test` updates test fixtures.
- `npm run update:ids` updates `src/unicode/ids.ts`.
- `npm run watch` runs tests with `--watch` option.

[`AST.Node`]: src/ast.ts#L4
[`RegExpParser.Options`]: src/parser.ts#L743
[`RegExpValidator.Options`]: src/validator.ts#L220
[`RegExpVisitor.Handlers`]: src/visitor.ts#L291
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 let random = async bytes => crypto.getRandomValues(new Uint8Array(bytes))

let customAlphabet = (alphabet, defaultSize = 21) => {
  // First, a bitmask is necessary to generate the ID. The bitmask makes bytes
  // values closer to the alphabet size. The bitmask calculates the closest
  // `2^31 - 1` number, which exceeds the alphabet size.
  // For example, the bitmask for the alphabet size 30 is 31 (00011111).
  // `Math.clz32` is not used, because it is not available in browsers.
  let mask = (2 << (Math.log(alphabet.length - 1) / Math.LN2)) - 1
  // Though, the bitmask solution is not perfect since the bytes exceeding
  // the alphabet size are refused. Therefore, to reliably generate the ID,
  // the random bytes redundancy has to be satisfied.

  // Note: every hardware random generator call is performance expensive,
  // because the system call for entropy collection takes a lot of time.
  // So, to avoid additional system calls, extra bytes are requested in advance.

  // Next, a step determines how many random bytes to generate.
  // The number of random bytes gets decided upon the ID size, mask,
  // alphabet size, and magic number 1.6 (using 1.6 peaks at performance
  // according to benchmarks).

  // `-~f => Math.ceil(f)` if f is a float
  // `-~i => i + 1` if i is an integer
  let step = -~((1.6 * mask * defaultSize) / alphabet.length)

  return async (size = defaultSize) => {
    let id = ''
    while (true) {
      let bytes = crypto.getRandomValues(new Uint8Array(step))
      // A compact alternative for `for (var i = 0; i < step; i++)`.
      let i = step | 0
      while (i--) {
        // Adding `|| ''` refuses a random byte that exceeds the alphabet size.
        id += alphabet[bytes[i] & mask] || ''
        if (id.length === size) return id
      }
    }
  }
}

let nanoid = async (size = 21) => {
  let id = ''
  let bytes = crypto.getRandomValues(new Uint8Array((size |= 0)))

  // A compact alternative for `for (var i = 0; i < step; i++)`.
  while (size--) {
    // It is incorrect to use bytes exceeding the alphabet size.
    // The following mask reduces the random byte in the 0-255 value
    // range to the 0-63 value range. Therefore, adding hacks, such
    // as empty string fallback or magic numbers, is unneccessary because
    // the bitmask trims bytes down to the alphabet size.
    let byte = bytes[size] & 63
    if (byte < 36) {
      // `0-9a-z`
      id += byte.toString(36)
    } else if (byte < 62) {
      // `A-Z`
      id += (byte - 26).toString(36).toUpperCase()
    } else if (byte < 63) {
      id += '_'
    } else {
      id += '-'
    }
  }
  return id
}

export { nanoid, customAlphabet, random }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      <h1 align="center">Picomatch</h1>

<p align="center">
<a href="https://npmjs.org/package/picomatch">
<img src="https://img.shields.io/npm/v/picomatch.svg" alt="version">
</a>
<a href="https://github.com/micromatch/picomatch/actions?workflow=Tests">
<img src="https://github.com/micromatch/picomatch/workflows/Tests/badge.svg" alt="test status">
</a>
<a href="https://coveralls.io/github/micromatch/picomatch">
<img src="https://img.shields.io/coveralls/github/micromatch/picomatch/master.svg" alt="coverage status">
</a>
<a href="https://npmjs.org/package/picomatch">
<img src="https://img.shields.io/npm/dm/picomatch.svg" alt="downloads">
</a>
</p>

<br>
<br>

<p align="center">
<strong>Blazing fast and accurate glob matcher written in JavaScript.</strong></br>
<em>No dependencies and full support for standard and extended Bash glob features, including braces, extglobs, POSIX brackets, and regular expressions.</em>
</p>

<br>
<br>

## Why picomatch?

* **Lightweight** - No dependencies
* **Minimal** - Tiny API surface. Main export is a function that takes a glob pattern and returns a matcher function.
* **Fast** - Loads in about 2ms (that's several times faster than a [single frame of a HD movie](http://www.endmemo.com/sconvert/framespersecondframespermillisecond.php) at 60fps)
* **Performant** - Use the returned matcher function to speed up repeat matching (like when watching files)
* **Accurate matching** - Using wildcards (`*` and `?`), globstars (`**`) for nested directories, [advanced globbing](#advanced-globbing) with extglobs, braces, and POSIX brackets, and support for escaping special characters with `\` or quotes.
* **Well tested** - Thousands of unit tests

See the [library comparison](#library-comparisons) to other libraries.

<br>
<br>

## Table of Contents

<details><summary> Click to expand </summary>

- [Install](#install)
- [Usage](#usage)
- [API](#api)
  * [picomatch](#picomatch)
  * [.test](#test)
  * [.matchBase](#matchbase)
  * [.isMatch](#ismatch)
  * [.parse](#parse)
  * [.scan](#scan)
  * [.compileRe](#compilere)
  * [.makeRe](#makere)
  * [.toRegex](#toregex)
- [Options](#options)
  * [Picomatch options](#picomatch-options)
  * [Scan Options](#scan-options)
  * [Options Examples](#options-examples)
- [Globbing features](#globbing-features)
  * [Basic globbing](#basic-globbing)
  * [Advanced globbing](#advanced-globbing)
  * [Braces](#braces)
  * [Matching special characters as literals](#matching-special-characters-as-literals)
- [Library Comparisons](#library-comparisons)
- [Benchmarks](#benchmarks)
- [Philosophies](#philosophies)
- [About](#about)
  * [Author](#author)
  * [License](#license)

_(TOC generated by [verb](https://github.com/verbose/verb) using [markdown-toc](https://github.com/jonschlinkert/markdown-toc))_

</details>

<br>
<br>

## Install

Install with [npm](https://www.npmjs.com/):

```sh
npm install --save picomatch
```

<br>

## Usage

The main export is a function that takes a glob pattern and an options object and returns a function for matching strings.

```js
const pm = require('picomatch');
const isMatch = pm('*.js');

console.log(isMatch('abcd')); //=> false
console.log(isMatch('a.js')); //=> true
console.log(isMatch('a.md')); //=> false
console.log(isMatch('a/b.js')); //=> false
```

<br>

## API

### [picomatch](lib/picomatch.js#L32)

Creates a matcher function from one or more glob patterns. The returned function takes a string to match as its first argument, and returns true if the string is a match. The returned matcher function also takes a boolean as the second argument that, when true, returns an object with additional information.

**Params**

* `globs` **{String|Array}**: One or more glob patterns.
* `options` **{Object=}**
* `returns` **{Function=}**: Returns a matcher function.

**Example**

```js
const picomatch = require('picomatch');
// picomatch(glob[, options]);

const isMatch = picomatch('*.!(*a)');
console.log(isMatch('a.a')); //=> false
console.log(isMatch('a.b')); //=> true
```

### [.test](lib/picomatch.js#L117)

Test `input` with the given `regex`. This is used by the main `picomatch()` function to test the input string.

**Params**

* `input` **{String}**: String to test.
* `regex` **{RegExp}**
* `returns` **{Object}**: Returns an object with matching info.

**Example**

```js
const picomatch = require('picomatch');
// picomatch.test(input, regex[, options]);

console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
// { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
```

### [.matchBase](lib/picomatch.js#L161)

Match the basename of a filepath.

**Params**

* `input` **{String}**: String to test.
* `glob` **{RegExp|String}**: Glob pattern or regex created by [.makeRe](#makeRe).
* `returns` **{Boolean}**

**Example**

```js
const picomatch = require('picomatch');
// picomatch.matchBase(input, glob[, options]);
console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
```

### [.isMatch](lib/picomatch.js#L183)

Returns true if **any** of the given glob `patterns` match the specified `string`.

**Params**

* **{String|Array}**: str The string to test.
* **{String|Array}**: patterns One or more glob patterns to use for matching.
* **{Object}**: See available [options](#options).
* `returns` **{Boolean}**: Returns true if any patterns match `str`

**Example**

```js
const picomatch = require('picomatch');
// picomatch.isMatch(string, patterns[, options]);

console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
```

### [.parse](lib/picomatch.js#L199)

Parse a glob pattern to create the source string for a regular expression.

**Params**

* `pattern` **{String}**
* `options` **{Object}**
* `returns` **{Object}**: Returns an object with useful properties and output to be used as a regex source string.

**Example**

```js
const picomatch = require('picomatch');
const result = picomatch.parse(pattern[, options]);
```

### [.scan](lib/picomatch.js#L231)

Scan a glob pattern to separate the pattern into segments.

**Params**

* `input` **{String}**: Glob pattern to scan.
* `options` **{Object}**
* `returns` **{Object}**: Returns an object with

**Example**

```js
const picomatch = require('picomatch');
// picomatch.scan(input[, options]);

const result = picomatch.scan('!./foo/*.js');
console.log(result);
{ prefix: '!./',
  input: '!./foo/*.js',
  start: 3,
  base: 'foo',
  glob: '*.js',
  isBrace: false,
  isBracket: false,
  isGlob: true,
  isExtglob: false,
  isGlobstar: false,
  negated: true }
```

### [.compileRe](lib/picomatch.js#L245)

Compile a regular expression from the `state` object returned by the
[parse()](#parse) method.

**Params**

* `state` **{Object}**
* `options` **{Object}**
* `returnOutput` **{Boolean}**: Intended for implementors, this argument allows you to return the raw output from the parser.
* `returnState` **{Boolean}**: Adds the state to a `state` property on the returned regex. Useful for implementors and debugging.
* `returns` **{RegExp}**

### [.makeRe](lib/picomatch.js#L286)

Create a regular expression from a parsed glob pattern.

**Params**

* `state` **{String}**: The object returned from the `.parse` method.
* `options` **{Object}**
* `returnOutput` **{Boolean}**: Implementors may use this argument to return the compiled output, instead of a regular expression. This is not exposed on the options to prevent end-users from mutating the result.
* `returnState` **{Boolean}**: Implementors may use this argument to return the state from the parsed glob with the returned regular expression.
* `returns` **{RegExp}**: Returns a regex created from the given pattern.

**Example**

```js
const picomatch = require('picomatch');
const state = picomatch.parse('*.js');
// picomatch.compileRe(state[, options]);

console.log(picomatch.compileRe(state));
//=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
```

### [.toRegex](lib/picomatch.js#L321)

Create a regular expression from the given regex source string.

**Params**

* `source` **{String}**: Regular expression source string.
* `options` **{Object}**
* `returns` **{RegExp}**

**Example**

```js
const picomatch = require('picomatch');
// picomatch.toRegex(source[, options]);

const { output } = picomatch.parse('*.js');
console.log(picomatch.toRegex(output));
//=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
```

<br>

## Options

### Picomatch options

The following options may be used with the main `picomatch()` function or any of the methods on the picomatch API.

| **Option** | **Type** | **Default value** | **Description** |
| --- | --- | --- | --- |
| `basename`            | `boolean`      | `false`     | If set, then patterns without slashes will be matched against the basename of the path if it contains slashes.  For example, `a?b` would match the path `/xyz/123/acb`, but not `/xyz/acb/123`. |
| `bash`                | `boolean`      | `false`     | Follow bash matching rules more strictly - disallows backslashes as escape characters, and treats single stars as globstars (`**`). |
| `capture`             | `boolean`      | `undefined` | Return regex matches in supporting methods. |
| `contains`            | `boolean`      | `undefined` | Allows glob to match any part of the given string(s). |
| `cwd`                 | `string`       | `process.cwd()` | Current working directory. Used by `picomatch.split()` |
| `debug`               | `boolean`      | `undefined` | Debug regular expressions when an error is thrown. |
| `dot`                 | `boolean`      | `false`     | Enable dotfile matching. By default, dotfiles are ignored unless a `.` is explicitly defined in the pattern, or `options.dot` is true |
| `expandRange`         | `function`     | `undefined` | Custom function for expanding ranges in brace patterns, such as `{a..z}`. The function receives the range values as two arguments, and it must return a string to be used in the generated regex. It's recommended that returned strings be wrapped in parentheses. |
| `failglob`            | `boolean`      | `false`     | Throws an error if no matches are found. Based on the bash option of the same name. |
| `fastpaths`           | `boolean`      | `true`      | To speed up processing, full parsing is skipped for a handful common glob patterns. Disable this behavior by setting this option to `false`. |
| `flags`               | `string`      | `undefined` | Regex flags to use in the generated regex. If defined, the `nocase` option will be overridden. |
| [format](#optionsformat) | `function` | `undefined` | Custom function for formatting the returned string. This is useful for removing leading slashes, converting Windows paths to Posix paths, etc. |
| `ignore`              | `array\|string` | `undefined` | One or more glob patterns for excluding strings that should not be matched from the result. |
| `keepQuotes`          | `boolean`      | `false`     | Retain quotes in the generated regex, since quotes may also be used as an alternative to backslashes.  |
| `literalBrackets`     | `boolean`      | `undefined` | When `true`, brackets in the glob pattern will be escaped so that only literal brackets will be matched. |
| `matchBase`           | `boolean`      | `false`     | Alias for `basename` |
| `maxLength`           | `boolean`      | `65536`     | Limit the max length of the input string. An error is thrown if the input string is longer than this value. |
| `nobrace`             | `boolean`      | `false`     | Disable brace matching, so that `{a,b}` and `{1..3}` would be treated as literal characters. |
| `nobracket`           | `boolean`      | `undefined` | Disable matching with regex brackets. |
| `nocase`              | `boolean`      | `false`     | Make matching case-insensitive. Equivalent to the regex `i` flag. Note that this option is overridden by the `flags` option. |
| `nodupes`             | `boolean`      | `true`      | Deprecated, use `nounique` instead. This option will be removed in a future major release. By default duplicates are removed. Disable uniquification by setting this option to false. |
| `noext`               | `boolean`      | `false`     | Alias for `noextglob` |
| `noextglob`           | `boolean`      | `false`     | Disable support for matching with 'use strict';

// var Construct = require('es-abstract/2024/Construct');
var CreateRegExpStringIterator = require('es-abstract/2024/CreateRegExpStringIterator');
var Get = require('es-abstract/2024/Get');
var Set = require('es-abstract/2024/Set');
var SpeciesConstructor = require('es-abstract/2024/SpeciesConstructor');
var ToLength = require('es-abstract/2024/ToLength');
var ToString = require('es-abstract/2024/ToString');
var Type = require('es-abstract/2024/Type');
var flagsGetter = require('regexp.prototype.flags');
var setFunctionName = require('set-function-name');
var callBound = require('call-bound');
var GetIntrinsic = require('get-intrinsic');
var $TypeError = require('es-errors/type');

var $indexOf = callBound('String.prototype.indexOf');

var OrigRegExp = GetIntrinsic('%RegExp%');

var supportsConstructingWithFlags = 'flags' in OrigRegExp.prototype;

var constructRegexWithFlags = function constructRegex(C, R) {
	var matcher;
	// workaround for older engines that lack RegExp.prototype.flags
	var flags = 'flags' in R ? Get(R, 'flags') : ToString(flagsGetter(R));
	if (supportsConstructingWithFlags && typeof flags === 'string') {
		matcher = new C(R, flags);
	} else if (C === OrigRegExp) {
		// workaround for older engines that can not construct a RegExp with flags
		matcher = new C(R.source, flags);
	} else {
		matcher = new C(R, flags);
	}
	return { flags: flags, matcher: matcher };
};

var regexMatchAll = setFunctionName(function SymbolMatchAll(string) {
	var R = this;
	if (Type(R) !== 'Object') {
		throw new $TypeError('"this" value must be an Object');
	}
	var S = ToString(string);
	var C = SpeciesConstructor(R, OrigRegExp);

	var tmp = constructRegexWithFlags(C, R);
	// var flags = ToString(Get(R, 'flags'));
	var flags = tmp.flags;
	// var matcher = Construct(C, [R, flags]);
	var matcher = tmp.matcher;

	var lastIndex = ToLength(Get(R, 'lastIndex'));
	Set(matcher, 'lastIndex', lastIndex, true);
	var global = $indexOf(flags, 'g') > -1;
	var fullUnicode = $indexOf(flags, 'u') > -1;
	return CreateRegExpStringIterator(matcher, S, global, fullUnicode);
}, '[Symbol.matchAll]', true);

module.exports = regexMatchAll;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              {
	"name": "string.prototype.repeat",
	"version": "1.0.0",
	"description": "A robust & optimized `String.prototype.repeat` polyfill, based on the ECMAScript 6 specification.",
	"homepage": "https://mths.be/repeat",
	"main": "index.js",
	"exports": {
		".": "./index.js",
		"./auto": "./auto.js",
		"./shim": "./shim.js",
		"./getPolyfill": "./getPolyfill.js",
		"./implementation": "./implementation.js",
		"./package.json": "./package.json"
	},
	"keywords": [
		"string",
		"repeat",
		"es6",
		"ecmascript",
		"polyfill"
	],
	"license": "MIT",
	"author": {
		"name": "Mathias Bynens",
		"url": "https://mathiasbynens.be/"
	},
	"repository": {
		"type": "git",
		"url": "https://github.com/mathiasbynens/String.prototype.repeat.git"
	},
	"bugs": "https://github.com/mathiasbynens/String.prototype.repeat/issues",
	"scripts": {
		"pretest": "es-shim-api --bound",
		"test": "npm run tests-only",
		"tests-only": "tape 'tests/*.js'",
		"cover": "istanbul cover --report html --verbose --dir coverage tape 'tests/*.js'"
	},
	"dependencies": {
		"define-properties": "^1.1.3",
		"es-abstract": "^1.17.5"
	},
	"devDependencies": {
		"@es-shims/api": "^2.1.2",
		"function-bind": "^1.1.1",
		"functions-have-names": "^1.2.1",
		"istanbul": "^0.4.5",
		"tape": "^5.0.0"
	}
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           'use strict';

var includes = require('../');
includes.shim();

var test = require('tape');
var defineProperties = require('define-properties');
var callBind = require('call-bind');
var isEnumerable = Object.prototype.propertyIsEnumerable;
var functionsHaveNames = require('functions-have-names')();

var runTests = require('./tests');

test('shimmed', function (t) {
	t.equal(String.prototype.includes.length, 1, 'String#includes has a length of 1');

	t.test('Function name', { skip: !functionsHaveNames }, function (st) {
		st.equal(String.prototype.includes.name, 'includes', 'String#includes has name "includes"');
		st.end();
	});

	t.test('enumerability', { skip: !defineProperties.supportsDescriptors }, function (st) {
		st.equal(false, isEnumerable.call(String.prototype, 'includes'), 'String#includes is not enumerable');
		st.end();
	});

	runTests(callBind(String.prototype.includes), t);

	t.end();
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           "use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _iterationDecorator = _interopRequireDefault(require("./util/iterationDecorator"));
var _AXObjectsMap = _interopRequireDefault(require("./AXObjectsMap"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(arr, i) { var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"]; if (_i == null) return; var _arr = []; var _n = true; var _d = false; var _s, _e; try { for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e2) { throw _e2; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e3) { didErr = true; err = _e3; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
var AXObjectRoleElements = [];
var _iterator = _createForOfIteratorHelper(_AXObjectsMap.default.entries()),
  _step;
try {
  var _loop = function _loop() {
    var _step$value = _slicedToArray(_step.value, 2),
      name = _step$value[0],
      def = _step$value[1];
    var relatedConcepts = def.relatedConcepts;
    if (Array.isArray(relatedConcepts)) {
      relatedConcepts.forEach(function (relation) {
        if (relation.module === 'ARIA') {
          var concept = relation.concept;
          if (concept) {
            var index = AXObjectRoleElements.findIndex(function (_ref5) {
              var _ref6 = _slicedToArray(_ref5, 1),
                key = _ref6[0];
              return key === name;
            });
            if (index === -1) {
              AXObjectRoleElements.push([name, []]);
              index = AXObjectRoleElements.length - 1;
            }
            AXObjectRoleElements[index][1].push(concept);
          }
        }
      });
    }
  };
  for (_iterator.s(); !(_step = _iterator.n()).done;) {
    _loop();
  }
} catch (err) {
  _iterator.e(err);
} finally {
  _iterator.f();
}
var AXObjectRoleMap = {
  entries: function entries() {
    return AXObjectRoleElements;
  },
  forEach: function forEach(fn) {
    var thisArg = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    for (var _i = 0, _AXObjectRoleElements = AXObjectRoleElements; _i < _AXObjectRoleElements.length; _i++) {
      var _AXObjectRoleElements2 = _slicedToArray(_AXObjectRoleElements[_i], 2),
        key = _AXObjectRoleElements2[0],
        values = _AXObjectRoleElements2[1];
      fn.call(thisArg, values, key, AXObjectRoleElements);
    }
  },
  get: function get(key) {
    var item = AXObjectRoleElements.find(function (tuple) {
      return tuple[0] === key ? true : false;
    });
    return item && item[1];
  },
  has: function has(key) {
    return !!AXObjectRoleMap.get(key);
  },
  keys: function keys() {
    return AXObjectRoleElements.map(function (_ref) {
      var _ref2 = _slicedToArray(_ref, 1),
        key = _ref2[0];
      return key;
    });
  },
  values: function values() {
    return AXObjectRoleElements.map(function (_ref3) {
      var _ref4 = _slicedToArray(_ref3, 2),
        values = _ref4[1];
      return values;
    });
  }
};
var _default = (0, _iterationDecorator.default)(AXObjectRoleMap, AXObjectRoleMap.entries());
exports.default = _default;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      'use strict';

var implementation = require('./implementation');

var supportsDescriptors = require('define-properties').supportsDescriptors;
var $gOPD = Object.getOwnPropertyDescriptor;

module.exports = function getPolyfill() {
	if (supportsDescriptors && (/a/mig).flags === 'gim') {
		var descriptor = $gOPD(RegExp.prototype, 'flags');
		if (
			descriptor
			&& typeof descriptor.get === 'function'
			&& 'dotAll' in RegExp.prototype
			&& 'hasIndices' in RegExp.prototype
		) {
			/* eslint getter-return: 0 */
			var calls = '';
			var o = {};
			Object.defineProperty(o, 'hasIndices', {
				get: function () {
					calls += 'd';
				}
			});
			Object.defineProperty(o, 'sticky', {
				get: function () {
					calls += 'y';
				}
			});

			descriptor.get.call(o);

			if (calls === 'dy') {
				return descriptor.get;
			}
		}
	}
	return implementation;
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                # internal-slot <sup>[![Version Badge][npm-version-svg]][package-url]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![dependency status][deps-svg]][deps-url]
[![dev dependency status][dev-deps-svg]][dev-deps-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][npm-badge-png]][package-url]

Truly private storage, akin to the JS specâ€™s concept of internal slots.

Uses a WeakMap when available; a Map when not; and a regular object in even older engines. Performance and garbage collection behavior will reflect the environmentâ€™s capabilities accordingly.

## Example

```js
var SLOT = require('internal-slot');
var assert = require('assert');

var o = {};

assert.throws(function () { SLOT.assert(o, 'foo'); });

assert.equal(SLOT.has(o, 'foo'), false);
assert.equal(SLOT.get(o, 'foo'), undefined);

SLOT.set(o, 'foo', 42);

assert.equal(SLOT.has(o, 'foo'), true);
assert.equal(SLOT.get(o, 'foo'), 42);

assert.doesNotThrow(function () { SLOT.assert(o, 'foo'); });
```

## Tests
Simply clone the repo, `npm install`, and run `npm test`

## Security

Please email [@ljharb](https://github.com/ljharb) or see https://tidelift.com/security if you have a potential security vulnerability to report.

[package-url]: https://npmjs.org/package/internal-slot
[npm-version-svg]: https://versionbadg.es/ljharb/internal-slot.svg
[deps-svg]: https://david-dm.org/ljharb/internal-slot.svg
[deps-url]: https://david-dm.org/ljharb/internal-slot
[dev-deps-svg]: https://david-dm.org/ljharb/internal-slot/dev-status.svg
[dev-deps-url]: https://david-dm.org/ljharb/internal-slot#info=devDependencies
[npm-badge-png]: https://nodei.co/npm/internal-slot.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/internal-slot.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/internal-slot.svg
[downloads-url]: https://npm-stat.com/charts.html?package=internal-slot
[codecov-image]: https://codecov.io/gh/ljharb/internal-slot/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/ljharb/internal-slot/
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/ljharb/internal-slot
[actions-url]: https://github.com/ljharb/internal-slot/actions
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         INDX( 	              (   X  è       Û                    hA    ` N     ½@    ‰%ýÅ‚eÛ×ÂSÆ‚eÛ×ÂSÆ‚eÛMeÛ                        e s 2 0 1 5   éJ    h V     ½@    PÓJÆ‚eÛåKÆ‚eÛåKÆ‚eÛåKÆ‚eÛ`       Z               
 i n d e x . d . t s   ¦C    h R     ½@    ¸™
Æ‚eÛ%ºÆ‚eÛ%ºÆ‚eÛ€|˜SŒeÛ @      w=               i n d e x . j s       ­L    p `     ½@    ˆ ZÆ‚eÛÓ7[Æ‚eÛÓ7[Æ‚eÛÓ7[Æ‚eÛ       5               L I C E N S E - M I T . t x t ÛH    p Z     ½@    –”8Æ‚e €4:Æ‚eÛ€4:Æ‚eÛ€|˜SŒeÛ       3               p a c k a g e . j s o n       yI    h T     ½@    Pk=Æ‚eÛ@Æ‚eÛ@Æ‚eÛ@Æ‚eÛ        ¡              	 R E A D M E . m d . j ÒK    p ^     ½@    WRÆ‚eÛDëRÆ‚eÛDëRÆ‚eÛDëRÆ‚eÛh       d                R G I _ E m o j i . d . t s   ØE    p Z     ½@    Q±Æ‚eÛ	WÆ‚eÛ	WÆ‚eÛ	WÆ‚eÛ @      °2               R G I _ E m o j i . j s       kL    h T     ½@    iÿWÆ‚eÛ_XÆ‚eÛ_XÆ‚eÛ_XÆ‚eÛ`       _               	 t e x t . d . t s    àG    ` P     ½@    q
0Æ‚eÛ—4Æ‚eÛ—4Æ‚eÛ—4Æ‚eÛ @      „8               t e x t . j s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         {
	"name": "call-bind-apply-helpers",
	"version": "1.0.1",
	"description": "Helper functions around Function call/apply/bind, for use in `call-bind`",
	"main": "index.js",
	"exports": {
		".": "./index.js",
		"./actualApply": "./actualApply.js",
		"./applyBind": "./applyBind.js",
		"./functionApply": "./functionApply.js",
		"./functionCall": "./functionCall.js",
		"./reflectApply": "./reflectApply.js",
		"./package.json": "./package.json"
	},
	"scripts": {
		"prepack": "npmignore --auto --commentLines=auto",
		"prepublish": "not-in-publish || npm run prepublishOnly",
		"prepublishOnly": "safe-publish-latest",
		"prelint": "evalmd README.md",
		"lint": "eslint --ext=.js,.mjs .",
		"postlint": "tsc -p . && attw -P",
		"pretest": "npm run lint",
		"tests-only": "nyc tape 'test/**/*.js'",
		"test": "npm run tests-only",
		"posttest": "npx npm@'>=10.2' audit --production",
		"version": "auto-changelog && git add CHANGELOG.md",
		"postversion": "auto-changelog && git add CHANGELOG.md && git commit --no-edit --amend && git tag -f \"v$(node -e \"console.log(require('./package.json').version)\")\""
	},
	"repository": {
		"type": "git",
		"url": "git+https://github.com/ljharb/call-bind-apply-helpers.git"
	},
	"author": "Jordan Harband <ljharb@gmail.com>",
	"license": "MIT",
	"bugs": {
		"url": "https://github.com/ljharb/call-bind-apply-helpers/issues"
	},
	"homepage": "https://github.com/ljharb/call-bind-apply-helpers#readme",
	"dependencies": {
		"es-errors": "^1.3.0",
		"function-bind": "^1.1.2"
	},
	"devDependencies": {
		"@arethetypeswrong/cli": "^0.17.1",
		"@ljharb/eslint-config": "^21.1.1",
		"@ljharb/tsconfig": "^0.2.2",
		"@types/for-each": "^0.3.3",
		"@types/function-bind": "^1.1.10",
		"@types/object-inspect": "^1.13.0",
		"@types/tape": "^5.6.5",
		"auto-changelog": "^2.5.0",
		"encoding": "^0.1.13",
		"es-value-fixtures": "^1.5.0",
		"eslint": "=8.8.0",
		"evalmd": "^0.0.19",
		"for-each": "^0.3.3",
		"has-strict-mode": "^1.0.1",
		"in-publish": "^2.0.1",
		"npmignore": "^0.3.1",
		"nyc": "^10.3.2",
		"object-inspect": "^1.13.3",
		"safe-publish-latest": "^2.0.0",
		"tape": "^5.9.0",
		"typescript": "next"
	},
	"testling": {
		"files": "test/index.js"
	},
	"auto-changelog": {
		"output": "CHANGELOG.md",
		"template": "keepachangelog",
		"unreleased": false,
		"commitLimit": false,
		"backfillLimit": false,
		"hideCredit": true
	},
	"publishConfig": {
		"ignore": [
			".github/workflows"
		]
	},
	"engines": {
		"node": ">= 0.4"
	}
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                # Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.2.0](https://github.com/inspect-js/has-proto/compare/v1.1.0...v1.2.0) - 2024-12-06

### Commits

- [Refactor] use `dunder-proto` instead of `call-bind` [`6e5e76c`](https://github.com/inspect-js/has-proto/commit/6e5e76ce3bf4c01ebb99b38dcd61bee1ba35073f)
- [actions] split out node 10-20, and 20+ [`3b8e9e6`](https://github.com/inspect-js/has-proto/commit/3b8e9e651431ef5e9725dae68881b8107e812ee0)
- [Dev Deps] update `@ljharb/tsconfig`, `gopd` [`57bcd00`](https://github.com/inspect-js/has-proto/commit/57bcd000625c7d1e7f41fd10b4a8e1ea380029dd)
- [actions] skip `npm ls` in node &lt; 10 [`ce3a4d7`](https://github.com/inspect-js/has-proto/commit/ce3a4d76d4f15d94540cb5f2ae50967cc6299ee3)

## [v1.1.0](https://github.com/inspect-js/has-proto/compare/v1.0.3...v1.1.0) - 2024-12-01

### Commits

- [New] add `accessor` and `mutator` endpoints [`144f6a9`](https://github.com/inspect-js/has-proto/commit/144f6a9c2a3925f25058d5d5ea7eab3be57767d9)
- [types] use shared config [`8b597cf`](https://github.com/inspect-js/has-proto/commit/8b597cff2b09f0351bc357cac0e0c7b0c8bb7e70)
- [Refactor] cache result at module level [`88418bd`](https://github.com/inspect-js/has-proto/commit/88418bde7e0c37c7d9aa6cc79150e774004c01d8)
- [Dev Deps] update `@ljharb/eslint-config`, `auto-changelog`, `tape` [`d246200`](https://github.com/inspect-js/has-proto/commit/d246200bae6ceceebb495df7f8eb0f27a017b63f)
- [Deps] update `gopd`, `reflect.getprototypeof` [`6f72364`](https://github.com/inspect-js/has-proto/commit/6f723645da9b5bef0aaae4a1aa66c07a1fed179f)
- [Tests] add `@arethetypeswrong/cli` [`8194e1a`](https://github.com/inspect-js/has-proto/commit/8194e1a607233f63c5bd0b91112c0423b3296ac9)
- [Tests] replace `aud` with `npm audit` [`fd7ad11`](https://github.com/inspect-js/has-proto/commit/fd7ad111dc35488b3200a763204dba0f6087defc)
- [Dev Deps] update `@types/tape` [`2695808`](https://github.com/inspect-js/has-proto/commit/26958086aec0b1cbfdddd4f10e54d2de1facf85c)
- [Dev Deps] add missing peer dep [`fa4b2f7`](https://github.com/inspect-js/has-proto/commit/fa4b2f77f7c0071e1c06b5590c9bada8e6b2edce)

## [v1.0.3](https://github.com/inspect-js/has-proto/compare/v1.0.2...v1.0.3) - 2024-02-19

### Commits

- [types] add missing declaration file [`26ecade`](https://github.com/inspect-js/has-proto/commit/26ecade05d253bb5dc376945ee3186d1fbe334f8)

## [v1.0.2](https://github.com/inspect-js/has-proto/compare/v1.0.1...v1.0.2) - 2024-02-19

### Commits

- add types [`6435262`](https://github.com/inspect-js/has-proto/commit/64352626cf511c0276d5f4bb6be770a0bf0f8524)
- [Dev Deps] update `@ljharb/eslint-config`, `aud`, `npmignore`, `tape` [`f16a5e4`](https://github.com/inspect-js/has-proto/commit/f16a5e4121651e551271419f9d60fdd3561fd82c)
- [Refactor] tiny cleanup [`d1f1a4b`](https://github.com/inspect-js/has-proto/commit/d1f1a4bdc135f115a10f148ce302676224534702)
- [meta] add `sideEffects` flag [`e7ab1a6`](https://github.com/inspect-js/has-proto/commit/e7ab1a6f153b3e80dee68d1748b71e46767a0531)

## [v1.0.1](https://github.com/inspect-js/has-proto/compare/v1.0.0...v1.0.1) - 2022-12-21

### Commits

- [meta] correct URLs and description [`ef34483`](https://github.com/inspect-js/has-proto/commit/ef34483ca0d35680f271b6b96e35526151b25dfc)
- [patch] add an additional criteria [`e81959e`](https://github.com/inspect-js/has-proto/commit/e81959ed7c7a77fbf459f00cb4ef824f1099497f)
- [Dev Deps] update `aud` [`2bec2c4`](https://github.com/inspect-js/has-proto/commit/2bec2c47b072b122ff5443fba0263f6dc649531f)

## v1.0.0 - 2022-12-12

### Commits

- Initial implementation, tests, readme [`6886fea`](https://github.com/inspect-js/has-proto/commit/6886fea578f67daf69a7920b2eb7637ea6ebb0bc)
- Initial commit [`99129c8`](https://github.com/inspect-js/has-proto/commit/99129c8f42471ac89cb681ba9cb9d52a583eb94f)
- npm init [`2844ad8`](https://github.com/inspect-js/has-proto/commit/2844ad8e75b84d66a46765b3bab9d2e8ea692e10)
- Only apps should have lockfiles [`c65bc5e`](https://github.com/inspect-js/has-proto/commit/c65bc5e40b9004463f7336d47c67245fb139a36a)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            {
	"name": "has-symbols",
	"version": "1.1.0",
	"description": "Determine if the JS environment has Symbol support. Supports spec, or shams.",
	"main": "index.js",
	"scripts": {
		"prepack": "npmignore --auto --commentLines=autogenerated",
		"prepublishOnly": "safe-publish-latest",
		"prepublish": "not-in-publish || npm run prepublishOnly",
		"pretest": "npm run --silent lint",
		"test": "npm run tests-only",
		"posttest": "npx npm@'>=10.2' audit --production",
		"tests-only": "npm run test:stock && npm run test:shams",
		"test:stock": "nyc node test",
		"test:staging": "nyc node --harmony --es-staging test",
		"test:shams": "npm run --silent test:shams:getownpropertysymbols && npm run --silent test:shams:corejs",
		"test:shams:corejs": "nyc node test/shams/core-js.js",
		"test:shams:getownpropertysymbols": "nyc node test/shams/get-own-property-symbols.js",
		"lint": "eslint --ext=js,mjs .",
		"postlint": "tsc -p . && attw -P",
		"version": "auto-changelog && git add CHANGELOG.md",
		"postversion": "auto-changelog && git add CHANGELOG.md && git commit --no-edit --amend && git tag -f \"v$(node -e \"console.log(require('./package.json').version)\")\""
	},
	"repository": {
		"type": "git",
		"url": "git://github.com/inspect-js/has-symbols.git"
	},
	"keywords": [
		"Symbol",
		"symbols",
		"typeof",
		"sham",
		"polyfill",
		"native",
		"core-js",
		"ES6"
	],
	"author": {
		"name": "Jordan Harband",
		"email": "ljharb@gmail.com",
		"url": "http://ljharb.codes"
	},
	"contributors": [
		{
			"name": "Jordan Harband",
			"email": "ljharb@gmail.com",
			"url": "http://ljharb.codes"
		}
	],
	"funding": {
		"url": "https://github.com/sponsors/ljharb"
	},
	"license": "MIT",
	"bugs": {
		"url": "https://github.com/ljharb/has-symbols/issues"
	},
	"homepage": "https://github.com/ljharb/has-symbols#readme",
	"devDependencies": {
		"@arethetypeswrong/cli": "^0.17.0",
		"@ljharb/eslint-config": "^21.1.1",
		"@ljharb/tsconfig": "^0.2.0",
		"@types/core-js": "^2.5.8",
		"@types/tape": "^5.6.5",
		"auto-changelog": "^2.5.0",
		"core-js": "^2.6.12",
		"encoding": "^0.1.13",
		"eslint": "=8.8.0",
		"get-own-property-symbols": "^0.9.5",
		"in-publish": "^2.0.1",
		"npmignore": "^0.3.1",
		"nyc": "^10.3.2",
		"safe-publish-latest": "^2.0.0",
		"tape": "^5.9.0",
		"typescript": "next"
	},
	"testling": {
		"files": "test/index.js",
		"browsers": [
			"iexplore/6.0..latest",
			"firefox/3.0..6.0",
			"firefox/15.0..latest",
			"firefox/nightly",
			"chrome/4.0..10.0",
			"chrome/20.0..latest",
			"chrome/canary",
			"opera/10.0..latest",
			"opera/next",
			"safari/4.0..latest",
			"ipad/6.0..latest",
			"iphone/6.0..latest",
			"android-browser/4.2"
		]
	},
	"engines": {
		"node": ">= 0.4"
	},
	"auto-changelog": {
		"output": "CHANGELOG.md",
		"template": "keepachangelog",
		"unreleased": false,
		"commitLimit": false,
		"backfillLimit": false,
		"hideCredit": true
	},
	"publishConfig": {
		"ignore": [
			".github/workflows",
			"types"
		]
	}
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  {
	"name": "es-errors",
	"version": "1.3.0",
	"description": "A simple cache for a few of the JS Error constructors.",
	"main": "index.js",
	"exports": {
		".": "./index.js",
		"./eval": "./eval.js",
		"./range": "./range.js",
		"./ref": "./ref.js",
		"./syntax": "./syntax.js",
		"./type": "./type.js",
		"./uri": "./uri.js",
		"./package.json": "./package.json"
	},
	"sideEffects": false,
	"scripts": {
		"prepack": "npmignore --auto --commentLines=autogenerated",
		"prepublishOnly": "safe-publish-latest",
		"prepublish": "not-in-publish || npm run prepublishOnly",
		"pretest": "npm run lint",
		"test": "npm run tests-only",
		"tests-only": "nyc tape 'test/**/*.js'",
		"posttest": "aud --production",
		"prelint": "evalmd README.md",
		"lint": "eslint --ext=js,mjs .",
		"postlint": "tsc -p . && eclint check $(git ls-files | xargs find 2> /dev/null | grep -vE 'node_modules|\\.git' | grep -v dist/)",
		"version": "auto-changelog && git add CHANGELOG.md",
		"postversion": "auto-changelog && git add CHANGELOG.md && git commit --no-edit --amend && git tag -f \"v$(node -e \"console.log(require('./package.json').version)\")\""
	},
	"repository": {
		"type": "git",
		"url": "git+https://github.com/ljharb/es-errors.git"
	},
	"keywords": [
		"javascript",
		"ecmascript",
		"error",
		"typeerror",
		"syntaxerror",
		"rangeerror"
	],
	"author": "Jordan Harband <ljharb@gmail.com>",
	"license": "MIT",
	"bugs": {
		"url": "https://github.com/ljharb/es-errors/issues"
	},
	"homepage": "https://github.com/ljharb/es-errors#readme",
	"devDependencies": {
		"@ljharb/eslint-config": "^21.1.0",
		"@types/tape": "^5.6.4",
		"aud": "^2.0.4",
		"auto-changelog": "^2.4.0",
		"eclint": "^2.8.1",
		"eslint": "^8.8.0",
		"evalmd": "^0.0.19",
		"in-publish": "^2.0.1",
		"npmignore": "^0.3.1",
		"nyc": "^10.3.2",
		"safe-publish-latest": "^2.0.0",
		"tape": "^5.7.4",
		"typescript": "next"
	},
	"auto-changelog": {
		"output": "CHANGELOG.md",
		"template": "keepachangelog",
		"unreleased": false,
		"commitLimit": false,
		"backfillLimit": false,
		"hideCredit": true
	},
	"publishConfig": {
		"ignore": [
			".github/workflows"
		]
	},
	"engines": {
		"node": ">= 0.4"
	}
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  'use strict';

require('../auto');

var test = require('tape');
var defineProperties = require('define-properties');
var callBind = require('call-bind');
var functionsHaveNames = require('functions-have-names')();

var isEnumerable = Object.prototype.propertyIsEnumerable;

var runTests = require('./tests');

var name = 'groupBy';
var fullName = 'Object.' + name;

test('shimmed', function (t) {
	var fn = Object[name];

	t.equal(fn.length, 2, fullName + ' has a length of 2');

	t.test('Function name', { skip: !functionsHaveNames }, function (st) {
		st.equal(fn.name, name, fullName + ' has name "' + name + '"');
		st.end();
	});

	t.test('enumerability', { skip: !defineProperties.supportsDescriptors }, function (et) {
		et.equal(false, isEnumerable.call(Object, name), fullName + ' is not enumerable');
		et.end();
	});

	runTests(callBind(fn, Object), t);

	t.end();
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                : 5066,
	"npn": 5067,
	"npo": 5068,
	"nps": 5069,
	"npu": 5070,
	"npx": 5071,
	"npy": 5072,
	"nqg": 5073,
	"nqk": 5074,
	"nql": 5075,
	"nqm": 5076,
	"nqn": 5077,
	"nqo": 5078,
	"nqq": 5079,
	"nqt": 5080,
	"nqy": 5081,
	"nra": 5082,
	"nrb": 5083,
	"nrc": 5084,
	"nre": 5085,
	"nrf": 5086,
	"nrg": 5087,
	"nri": 5088,
	"nrk": 5089,
	"nrl": 5090,
	"nrm": 5091,
	"nrn": 5092,
	"nrp": 5093,
	"nrr": 5094,
	"nrt": 5095,
	"nru": 5096,
	"nrx": 5097,
	"nrz": 5098,
	"nsa": 5099,
	"nsb": 5100,
	"nsc": 5101,
	"nsd": 5102,
	"nse": 5103,
	"nsf": 5104,
	"nsg": 5105,
	"nsh": 5106,
	"nsi": 5107,
	"nsk": 5108,
	"nsl": 5109,
	"nsm": 5110,
	"nsn": 5111,
	"nso": 5112,
	"nsp": 5113,
	"nsq": 5114,
	"nsr": 5115,
	"nss": 5116,
	"nst": 5117,
	"nsu": 5118,
	"nsv": 5119,
	"nsw": 5120,
	"nsx": 5121,
	"nsy": 5122,
	"nsz": 5123,
	"ntd": 5124,
	"nte": 5125,
	"ntg": 5126,
	"nti": 5127,
	"ntj": 5128,
	"ntk": 5129,
	"ntm": 5130,
	"nto": 5131,
	"ntp": 5132,
	"ntr": 5133,
	"nts": 5134,
	"ntu": 5135,
	"ntw": 5136,
	"ntx": 5137,
	"nty": 5138,
	"ntz": 5139,
	"nua": 5140,
	"nub": 5141,
	"nuc": 5142,
	"nud": 5143,
	"nue": 5144,
	"nuf": 5145,
	"nug": 5146,
	"nuh": 5147,
	"nui": 5148,
	"nuj": 5149,
	"nuk": 5150,
	"nul": 5151,
	"num": 5152,
	"nun": 5153,
	"nuo": 5154,
	"nup": 5155,
	"nuq": 5156,
	"nur": 5157,
	"nus": 5158,
	"nut": 5159,
	"nuu": 5160,
	"nuv": 5161,
	"nuw": 5162,
	"nux": 5163,
	"nuy": 5164,
	"nuz": 5165,
	"nvh": 5166,
	"nvm": 5167,
	"nvo": 5168,
	"nwa": 5169,
	"nwb": 5170,
	"nwc": 5171,
	"nwe": 5172,
	"nwg": 5173,
	"nwi": 5174,
	"nwm": 5175,
	"nwo": 5176,
	"nwr": 5177,
	"nww": 5178,
	"nwx": 5179,
	"nwy": 5180,
	"nxa": 5181,
	"nxd": 5182,
	"nxe": 5183,
	"nxg": 5184,
	"nxi": 5185,
	"nxk": 5186,
	"nxl": 5187,
	"nxm": 5188,
	"nxn": 5189,
	"nxo": 5190,
	"nxq": 5191,
	"nxr": 5192,
	"nxu": 5193,
	"nxx": 5194,
	"nyb": 5195,
	"nyc": 5196,
	"nyd": 5197,
	"nye": 5198,
	"nyf": 5199,
	"nyg": 5200,
	"nyh": 5201,
	"nyi": 5202,
	"nyj": 5203,
	"nyk": 5204,
	"nyl": 5205,
	"nym": 5206,
	"nyn": 5207,
	"nyo": 5208,
	"nyp": 5209,
	"nyq": 5210,
	"nyr": 5211,
	"nys": 5212,
	"nyt": 5213,
	"nyu": 5214,
	"nyv": 5215,
	"nyw": 5216,
	"nyx": 5217,
	"nyy": 5218,
	"nza": 5219,
	"nzb": 5220,
	"nzd": 5221,
	"nzi": 5222,
	"nzk": 5223,
	"nzm": 5224,
	"nzr": 5225,
	"nzs": 5226,
	"nzu": 5227,
	"nzy": 5228,
	"nzz": 5229,
	"oaa": 5230,
	"oac": 5231,
	"oar": 5232,
	"oav": 5233,
	"obi": 5234,
	"obk": 5235,
	"obl": 5236,
	"obm": 5237,
	"obo": 5238,
	"obr": 5239,
	"obt": 5240,
	"obu": 5241,
	"oca": 5242,
	"och": 5243,
	"ocm": 5244,
	"oco": 5245,
	"ocu": 5246,
	"oda": 5247,
	"odk": 5248,
	"odt": 5249,
	"odu": 5250,
	"ofo": 5251,
	"ofs": 5252,
	"ofu": 5253,
	"ogb": 5254,
	"ogc": 5255,
	"oge": 5256,
	"ogg": 5257,
	"ogo": 5258,
	"ogu": 5259,
	"oht": 5260,
	"ohu": 5261,
	"oia": 5262,
	"oie": 5263,
	"oin": 5264,
	"ojb": 5265,
	"ojc": 5266,
	"ojg": 5267,
	"ojp": 5268,
	"ojs": 5269,
	"ojv": 5270,
	"ojw": 5271,
	"oka": 5272,
	"okb": 5273,
	"okc": 5274,
	"okd": 5275,
	"oke": 5276,
	"okg": 5277,
	"okh": 5278,
	"oki": 5279,
	"okj": 5280,
	"okk": 5281,
	"okl": 5282,
	"okm": 5283,
	"okn": 5284,
	"oko": 5285,
	"okr": 5286,
	"oks": 5287,
	"oku": 5288,
	"okv": 5289,
	"okx": 5290,
	"okz": 5291,
	"ola": 5292,
	"old": 5293,
	"ole": 5294,
	"olk": 5295,
	"olm": 5296,
	"olo": 5297,
	"olr": 5298,
	"olt": 5299,
	"olu": 5300,
	"oma": 5301,
	"omb": 5302,
	"omc": 5303,
	"ome": 5304,
	"omg": 5305,
	"omi": 5306,
	"omk": 5307,
	"oml": 5308,
	"omn": 5309,
	"omo": 5310,
	"omp": 5311,
	"omq": 5312,
	"omr": 5313,
	"omt": 5314,
	"omu": 5315,
	"omv": 5316,
	"omw": 5317,
	"omx": 5318,
	"omy": 5319,
	"ona": 5320,
	"onb": 5321,
	"one": 5322,
	"ong": 5323,
	"oni": 5324,
	"onj": 5325,
	"onk": 5326,
	"onn": 5327,
	"ono": 5328,
	"onp": 5329,
	"onr": 5330,
	"ons": 5331,
	"ont": 5332,
	"onu": 5333,
	"onw": 5334,
	"onx": 5335,
	"ood": 5336,
	"oog": 5337,
	"oon": 5338,
	"oor": 5339,
	"oos": 5340,
	"opa": 5341,
	"opk": 5342,
	"opm": 5343,
	"opo": 5344,
	"opt": 5345,
	"opy": 5346,
	"ora": 5347,
	"orc": 5348,
	"ore": 5349,
	"org": 5350,
	"orh": 5351,
	"orn": 5352,
	"oro": 5353,
	"orr": 5354,
	"ors": 5355,
	"ort": 5356,
	"oru": 5357,
	"orv": 5358,
	"orw": 5359,
	"orx": 5360,
	"ory": 5361,
	"orz": 5362,
	"osa": 5363,
	"osc": 5364,
	"osi": 5365,
	"osn": 5366,
	"oso": 5367,
	"osp": 5368,
	"ost": 5369,
	"osu": 5370,
	"osx": 5371,
	"ota": 5372,
	"otb": 5373,
	"otd": 5374,
	"ote": 5375,
	"oti": 5376,
	"otk": 5377,
	"otl": 5378,
	"otm": 5379,
	"otn": 5380,
	"oto": 5381,
	"otq": 5382,
	"otr": 5383,
	"ots": 5384,
	"ott": 5385,
	"otu": 5386,
	"otw": 5387,
	"otx": 5388,
	"oty": 5389,
	"otz": 5390,
	"oua": 5391,
	"oub": 5392,
	"oue": 5393,
	"oui": 5394,
	"oum": 5395,
	"oun": 5396,
	"ovd": 5397,
	"owi": 5398,
	"owl": 5399,
	"oyb": 5400,
	"oyd": 5401,
	"oym": 5402,
	"oyy": 5403,
	"ozm": 5404,
	"paa": 5405,
	"pab": 5406,
	"pac": 5407,
	"pad": 5408,
	"pae": 5409,
	"paf": 5410,
	"pag": 5411,
	"pah": 5412,
	"pai": 5413,
	"pak": 5414,
	"pal": 5415,
	"pam": 5416,
	"pao": 5417,
	"pap": 5418,
	"paq": 5419,
	"par": 5420,
	"pas": 5421,
	"pat": 5422,
	"pau": 5423,
	"pav": 5424,
	"paw": 5425,
	"pax": 5426,
	"pay": 5427,
	"paz": 5428,
	"pbb": 5429,
	"pbc": 5430,
	"pbe": 5431,
	"pbf": 5432,
	"pbg": 5433,
	"pbh": 5434,
	"pbi": 5435,
	"pbl": 5436,
	"pbm": 5437,
	"pbn": 5438,
	"pbo": 5439,
	"pbp": 5440,
	"pbr": 5441,
	"pbs": 5442,
	"pbt": 5443,
	"pbu": 5444,
	"pbv": 5445,
	"pby": 5446,
	"pbz": 5447,
	"pca": 5448,
	"pcb": 5449,
	"pcc": 5450,
	"pcd": 5451,
	"pce": 5452,
	"pcf": 5453,
	"pcg": 5454,
	"pch": 5455,
	"pci": 5456,
	"pcj": 5457,
	"pck": 5458,
	"pcl": 5459,
	"pcm": 5460,
	"pcn": 5461,
	"pcp": 5462,
	"pcr": 5463,
	"pcw": 5464,
	"pda": 5465,
	"pdc": 5466,
	"pdi": 5467,
	"pdn": 5468,
	"pdo": 5469,
	"pdt": 5470,
	"pdu": 5471,
	"pea": 5472,
	"peb": 5473,
	"ped": 5474,
	"pee": 5475,
	"pef": 5476,
	"peg": 5477,
	"peh": 5478,
	"pei": 5479,
	"pej": 5480,
	"pek": 5481,
	"pel": 5482,
	"pem": 5483,
	"peo": 5484,
	"pep": 5485,
	"peq": 5486,
	"pes": 5487,
	"pev": 5488,
	"pex": 5489,
	"pey": 5490,
	"pez": 5491,
	"pfa": 5492,
	"pfe": 5493,
	"pfl": 5494,
	"pga": 5495,
	"pgd": 5496,
	"pgg": 5497,
	"pgi": 5498,
	"pgk": 5499,
	"pgl": 5500,
	"pgn": 5501,
	"pgs": 5502,
	"pgu": 5503,
	"pgy": 5504,
	"pgz": 5505,
	"pha": 5506,
	"phd": 5507,
	"phg": 5508,
	"phh": 5509,
	"phi": 5510,
	"phj": 5511,
	"phk": 5512,
	"phl": 5513,
	"phm": 5514,
	"phn": 5515,
	"pho": 5516,
	"phq": 5517,
	"phr": 5518,
	"pht": 5519,
	"phu": 5520,
	"phv": 5521,
	"phw": 5522,
	"pia": 5523,
	"pib": 5524,
	"pic": 5525,
	"pid": 5526,
	"pie": 5527,
	"pif": 5528,
	"pig": 5529,
	"pih": 5530,
	"pii": 5531,
	"pij": 5532,
	"pil": 5533,
	"pim": 5534,
	"pin": 5535,
	"pio": 5536,
	"pip": 5537,
	"pir": 5538,
	"pis": 5539,
	"pit": 5540,
	"piu": 5541,
	"piv": 5542,
	"piw": 5543,
	"pix": 5544,
	"piy": 5545,
	"piz": 5546,
	"pjt": 5547,
	"pka": 5548,
	"pkb": 5549,
	"pkc": 5550,
	"pkg": 5551,
	"pkh": 5552,
	"pkn": 5553,
	"pko": 5554,
	"pkp": 5555,
	"pkr": 5556,
	"pks": 5557,
	"pkt": 5558,
	"pku": 5559,
	"pla": 5560,
	"plb": 5561,
	"plc": 5562,
	"pld": 5563,
	"ple": 5564,
	"plf": 5565,
	"plg": 5566,
	"plh": 5567,
	"plj": 5568,
	"plk": 5569,
	"pll": 5570,
	"pln": 5571,
	"plo": 5572,
	"plp": 5573,
	"plq": 5574,
	"plr": 5575,
	"pls": 5576,
	"plt": 5577,
	"plu": 5578,
	"plv": 5579,
	"plw": 5580,
	"ply": 5581,
	"plz": 5582,
	"pma": 5583,
	"pmb": 5584,
	"pmc": 5585,
	"pmd": 5586,
	"pme": 5587,
	"pmf": 5588,
	"pmh": 5589,
	"pmi": 5590,
	"pmj": 5591,
	"pmk": 5592,
	"pml": 5593,
	"pmm": 5594,
	"pmn": 5595,
	"pmo": 5596,
	"pmq": 5597,
	"pmr": 5598,
	"pms": 5599,
	"pmt": 5600,
	"pmu": 5601,
	"pmw": 5602,
	"pmx": 5603,
	"pmy": 5604,
	"pmz": 5605,
	"pna": 5606,
	"pnb": 5607,
	"pnc": 5608,
	"pnd": 5609,
	"pne": 5610,
	"png": 5611,
	"pnh": 5612,
	"pni": 5613,
	"pnj": 5614,
	"pnk": 5615,
	"pnl": 5616,
	"pnm": 5617,
	"pnn": 5618,
	"pno": 5619,
	"pnp": 5620,
	"pnq": 5621,
	"pnr": 5622,
	"pns": 5623,
	"pnt": 5624,
	"pnu": 5625,
	"pnv": 5626,
	"pnw": 5627,
	"pnx": 5628,
	"pny": 5629,
	"pnz": 5630,
	"poc": 5631,
	"pod": 5632,
	"poe": 5633,
	"pof": 5634,
	"pog": 5635,
	"poh": 5636,
	"poi": 5637,
	"pok": 5638,
	"pom": 5639,
	"pon": 5640,
	"poo": 5641,
	"pop": 5642,
	"poq": 5643,
	"pos": 5644,
	"pot": 5645,
	"pov": 5646,
	"pow": 5647,
	"pox": 5648,
	"poy": 5649,
	"poz": 5650,
	"ppa": 5651,
	"ppe": 5652,
	"ppi": 5653,
	"ppk": 5654,
	"ppl": 5655,
	"ppm": 5656,
	"ppn": 5657,
	"ppo": 5658,
	"ppp": 5659,
	"ppq": 5660,
	"ppr": 5661,
	"pps": 5662,
	"ppt": 5663,
	"ppu": 5664,
	"pqa": 5665,
	"pqe": 5666,
	"pqm": 5667,
	"pqw": 5668,
	"pra": 5669,
	"prb": 5670,
	"prc": 5671,
	"prd": 5672,
	"pre": 5673,
	"prf": 5674,
	"prg": 5675,
	"prh": 5676,
	"pri": 5677,
	"prk": 5678,
	"prl": 5679,
	"prm": 5680,
	"prn": 5681,
	"pro": 5682,
	"prp": 5683,
	"prq": 5684,
	"prr": 5685,
	"prs": 5686,
	"prt": 5687,
	"pru": 5688,
	"prw": 5689,
	"prx": 5690,
	"pry": 5691,
	"prz": 5692,
	"psa": 5693,
	"psc": 5694,
	"psd": 5695,
	"pse": 5696,
	"psg": 5697,
	"psh": 5698,
	"psi": 5699,
	"psl": 5700,
	"psm": 5701,
	"psn": 5702,
	"pso": 5703,
	"psp": 5704,
	"psq": 5705,
	"psr": 5706,
	"pss": 5707,
	"pst": 5708,
	"psu": 5709,
	"psw": 5710,
	"psy": 5711,
	"pta": 5712,
	"pth": 5713,
	"pti": 5714,
	"ptn": 5715,
	"pto": 5716,
	"ptp": 5717,
	"ptq": 5718,
	"ptr": 5719,
	"ptt": 5720,
	"ptu": 5721,
	"ptv": 5722,
	"ptw": 5723,
	"pty": 5724,
	"pua": 5725,
	"pub": 5726,
	"puc": 5727,
	"pud": 5728,
	"pue": 5729,
	"puf": 5730,
	"pug": 5731,
	"pui": 5732,
	"puj": 5733,
	"puk": 5734,
	"pum": 5735,
	"puo": 5736,
	"pup": 5737,
	"puq": 5738,
	"pur": 5739,
	"put": 5740,
	"puu": 5741,
	"puw": 5742,
	"pux": 5743,
	"puy": 5744,
	"puz": 5745,
	"pwa": 5746,
	"pwb": 5747,
	"pwg": 5748,
	"pwi": 5749,
	"pwm": 5750,
	"pwn": 5751,
	"pwo": 5752,
	"pwr": 5753,
	"pww": 5754,
	"pxm": 5755,
	"pye": 5756,
	"pym": 5757,
	"pyn": 5758,
	"pys": 5759,
	"pyu": 5760,
	"pyx": 5761,
	"pyy": 5762,
	"pze": 5763,
	"pzh": 5764,
	"pzn": 5765,
	"qaa..qtz": 5766,
	"qua": 5767,
	"qub": 5768,
	"quc": 5769,
	"qud": 5770,
	"quf": 5771,
	"qug": 5772,
	"quh": 5773,
	"qui": 5774,
	"quk": 5775,
	"qul": 5776,
	"qum": 5777,
	"qun": 5778,
	"qup": 5779,
	"quq": 5780,
	"qur": 5781,
	"qus": 5782,
	"quv": 5783,
	"quw": 5784,
	"qux": 5785,
	"quy": 5786,
	"quz": 5787,
	"qva": 5788,
	"qvc": 5789,
	"qve": 5790,
	"qvh": 5791,
	"qvi": 5792,
	"qvj": 5793,
	"qvl": 5794,
	"qvm": 5795,
	"qvn": 5796,
	"qvo": 5797,
	"qvp": 5798,
	"qvs": 5799,
	"qvw": 5800,
	"qvy": 5801,
	"qvz": 5802,
	"qwa": 5803,
	"qwc": 5804,
	"qwe": 5805,
	"qwh": 5806,
	"qwm": 5807,
	"qws": 5808,
	"qwt": 5809,
	"qxa": 5810,
	"qxc": 5811,
	"qxh": 5812,
	"qxl": 5813,
	"qxn": 5814,
	"qxo": 5815,
	"qxp": 5816,
	"qxq": 5817,
	"qxr": 5818,
	"qxs": 5819,
	"qxt": 5820,
	"qxu": 5821,
	"qxw": 5822,
	"qya": 5823,
	"qyp": 5824,
	"raa": 5825,
	"rab": 5826,
	"rac": 5827,
	"rad": 5828,
	"raf": 5829,
	"rag": 5830,
	"rah": 5831,
	"rai": 5832,
	"raj": 5833,
	"rak": 5834,
	"ral": 5835,
	"ram": 5836,
	"ran": 5837,
	"rao": 5838,
	"rap": 5839,
	"raq": 5840,
	"rar": 5841,
	"ras": 5842,
	"rat": 5843,
	"rau": 5844,
	"rav": 5845,
	"raw": 5846,
	"rax": 5847,
	"ray": 5848,
	"raz": 5849,
	"rbb": 5850,
	"rbk": 5851,
	"rbl": 5852,
	"rbp": 5853,
	"rcf": 5854,
	"rdb": 5855,
	"rea": 5856,
	"reb": 5857,
	"ree": 5858,
	"reg": 5859,
	"rei": 5860,
	"rej": 5861,
	"rel": 5862,
	"rem": 5863,
	"ren": 5864,
	"rer": 5865,
	"res": 5866,
	"ret": 5867,
	"rey": 5868,
	"rga": 5869,
	"rge": 5870,
	"rgk": 5871,
	"rgn": 5872,
	"rgr": 5873,
	"rgs": 5874,
	"rgu": 5875,
	"rhg": 5876,
	"rhp": 5877,
	"ria": 5878,
	"rib": 5879,
	"rie": 5880,
	"rif": 5881,
	"ril": 5882,
	"rim": 5883,
	"rin": 5884,
	"rir": 5885,
	"rit": 5886,
	"riu": 5887,
	"rjg": 5888,
	"rji": 5889,
	"rjs": 5890,
	"rka": 5891,
	"rkb": 5892,
	"rkh": 5893,
	"rki": 5894,
	"rkm": 5895,
	"rkt": 5896,
	"rkw": 5897,
	"rma": 5898,
	"rmb": 5899,
	"rmc": 5900,
	"rmd": 5901,
	"rme": 5902,
	"rmf": 5903,
	"rmg": 5904,
	"rmh": 5905,
	"rmi": 5906,
	"rmk": 5907,
	"rml": 5908,
	"rmm": 5909,
	"rmn": 5910,
	"rmo": 5911,
	"rmp": 5912,
	"rmq": 5913,
	"rmr": 5914,
	"rms": 5915,
	"rmt": 5916,
	"rmu": 5917,
	"rmv": 5918,
	"rmw": 5919,
	"rmx": 5920,
	"rmy": 5921,
	"rmz": 5922,
	"rna": 5923,
	"rnb": 5924,
	"rnd": 5925,
	"rng": 5926,
	"rnl": 5927,
	"rnn": 5928,
	"rnp": 5929,
	"rnr": 5930,
	"rnw": 5931,
	"roa": 5932,
	"rob": 5933,
	"roc": 5934,
	"rod": 5935,
	"roe": 5936,
	"rof": 5937,
	"rog": 5938,
	"rol": 5939,
	"rom": 5940,
	"roo": 5941,
	"rop": 5942,
	"ror": 5943,
	"rou": 5944,
	"row": 5945,
	"rpn": 5946,
	"rpt": 5947,
	"rri": 5948,
	"rrm": 5949,
	"rro": 5950,
	"rrt": 5951,
	"rsb": 5952,
	"rsi": 5953,
	"rsk": 5954,
	"rsl": 5955,
	"rsm": 5956,
	"rsn": 5957,
	"rsw": 5958,
	"rtc": 5959,
	"rth": 5960,
	"rtm": 5961,
	"rts": 5962,
	"rtw": 5963,
	"rub": 5964,
	"ruc": 5965,
	"rue": 5966,
	"ruf": 5967,
	"rug": 5968,
	"ruh": 5969,
	"rui": 5970,
	"ruk": 5971,
	"ruo": 5972,
	"rup": 5973,
	"ruq": 5974,
	"rut": 5975,
	"ruu": 5976,
	"ruy": 5977,
	"ruz": 5978,
	"rwa": 5979,
	"rwk": 5980,
	"rwl": 5981,
	"rwm": 5982,
	"rwo": 5983,
	"rwr": 5984,
	"rxd": 5985,
	"rxw": 5986,
	"ryn": 5987,
	"rys": 5988,
	"ryu": 5989,
	"rzh": 5990,
	"saa": 5991,
	"sab": 5992,
	"sac": 5993,
	"sad": 5994,
	"sae": 5995,
	"saf": 5996,
	"sah": 5997,
	"sai": 5998,
	"saj": 5999,
	"sak": 6000,
	"sal": 6001,
	"sam": 6002,
	"sao": 6003,
	"sap": 6004,
	"saq": 6005,
	"sar": 6006,
	"sas": 6007,
	"sat": 6008,
	"sau": 6009,
	"sav": 6010,
	"saw": 6011,
	"sax": 6012,
	"say": 6013,
	"saz": 6014,
	"sba": 6015,
	"sbb": 6016,
	"sbc": 6017,
	"sbd": 6018,
	"sbe": 6019,
	"sbf": 6020,
	"sbg": 6021,
	"sbh": 6022,
	"sbi": 6023,
	"sbj": 6024,
	"sbk": 6025,
	"sbl": 6026,
	"sbm": 6027,
	"sbn": 6028,
	"sbo": 6029,
	"sbp": 6030,
	"sbq": 6031,
	"sbr": 6032,
	"sbs": 6033,
	"sbt": 6034,
	"sbu": 6035,
	"sbv": 6036,
	"sbw": 6037,
	"sbx": 6038,
	"sby": 6039,
	"sbz": 6040,
	"sca": 6041,
	"scb": 6042,
	"sce": 6043,
	"scf": 6044,
	"scg": 6045,
	"sch": 6046,
	"sci": 6047,
	"sck": 6048,
	"scl": 6049,
	"scn": 6050,
	"sco": 6051,
	"scp": 6052,
	"scq": 6053,
	"scs": 6054,
	"sct": 6055,
	"scu": 6056,
	"scv": 6057,
	"scw": 6058,
	"scx": 6059,
	"sda": 6060,
	"sdb": 6061,
	"sdc": 6062,
	"sde": 6063,
	"sdf": 6064,
	"sdg": 6065,
	"sdh": 6066,
	"sdj": 6067,
	"sdk": 6068,
	"sdl": 6069,
	"sdm": 6070,
	"sdn": 6071,
	"sdo": 6072,
	"sdp": 6073,
	"sdq": 6074,
	"sdr": 6075,
	"sds": 6076,
	"sdt": 6077,
	"sdu": 6078,
	"sdv": 6079,
	"sdx": 6080,
	"sdz": 6081,
	"sea": 6082,
	"seb": 6083,
	"sec": 6084,
	"sed": 6085,
	"see": 6086,
	"sef": 6087,
	"seg": 6088,
	"seh": 6089,
	"sei": 6090,
	"sej": 6091,
	"sek": 6092,
	"sel": 6093,
	"sem": 6094,
	"sen": 6095,
	"seo": 6096,
	"sep": 6097,
	"seq": 6098,
	"ser": 6099,
	"ses": 6100,
	"set": 6101,
	"seu": 6102,
	"sev": 6103,
	"sew": 6104,
	"sey": 6105,
	"sez": 6106,
	"sfb": 6107,
	"sfe": 6108,
	"sfm": 6109,
	"sfs": 6110,
	"sfw": 6111,
	"sga": 6112,
	"sgb": 6113,
	"sgc": 6114,
	"sgd": 6115,
	"sge": 6116,
	"sgg": 6117,
	"sgh": 6118,
	"sgi": 6119,
	"sgj": 6120,
	"sgk": 6121,
	"sgl": 6122,
	"sgm": 6123,
	"sgn": 6124,
	"sgo": 6125,
	"sgp": 6126,
	"sgr": 6127,
	"sgs": 6128,
	"sgt": 6129,
	"sgu": 6130,
	"sgw": 6131,
	"sgx": 6132,
	"sgy": 6133,
	"sgz": 6134,
	"sha": 6135,
	"shb": 6136,
	"shc": 6137,
	"shd": 6138,
	"she": 6139,
	"shg": 6140,
	"shh": 6141,
	"shi": 6142,
	"shj": 6143,
	"shk": 6144,
	"shl": 6145,
	"shm": 6146,
	"shn": 6147,
	"sho": 6148,
	"shp": 6149,
	"shq": 6150,
	"shr": 6151,
	"shs": 6152,
	"sht": 6153,
	"shu": 6154,
	"shv": 6155,
	"shw": 6156,
	"shx": 6157,
	"shy": 6158,
	"shz": 6159,
	"sia": 6160,
	"sib": 6161,
	"sid": 6162,
	"sie": 6163,
	"sif": 6164,
	"sig": 6165,
	"sih": 6166,
	"sii": 6167,
	"sij": 6168,
	"sik": 6169,
	"sil": 6170,
	"sim": 6171,
	"sio": 6172,
	"sip": 6173,
	"siq": 6174,
	"sir": 6175,
	"sis": 6176,
	"sit": 6177,
	"siu": 6178,
	"siv": 6179,
	"siw": 6180,
	"six": 6181,
	"siy": 6182,
	"siz": 6183,
	"sja": 6184,
	"sjb": 6185,
	"sjd": 6186,
	"sje": 6187,
	"sjg": 6188,
	"sjk": 6189,
	"sjl": 6190,
	"sjm": 6191,
	"sjn": 6192,
	"sjo": 6193,
	"sjp": 6194,
	"sjr": 6195,
	"sjs": 6196,
	"sjt": 6197,
	"sju": 6198,
	"sjw": 6199,
	"ska": 6200,
	"skb": 6201,
	"skc": 6202,
	"skd": 6203,
	"ske": 6204,
	"skf": 6205,
	"skg": 6206,
	"skh": 6207,
	"ski": 6208,
	"skj": 6209,
	"skk": 6210,
	"skm": 6211,
	"skn": 6212,
	"sko": 6213,
	"skp": 6214,
	"skq": 6215,
	"skr": 6216,
	"sks": 6217,
	"skt": 6218,
	"sku": 6219,
	"skv": 6220,
	"skw": 6221,
	"skx": 6222,
	"sky": 6223,
	"skz": 6224,
	"sla": 6225,
	"slc": 6226,
	"sld": 6227,
	"sle": 6228,
	"slf": 6229,
	"slg": 6230,
	"slh": 6231,
	"sli": 6232,
	"slj": 6233,
	"sll": 6234,
	"slm": 6235,
	"sln'use strict';

var orig = Array.prototype.findLastIndex;

require('../auto');

var test = require('tape');
var hasOwn = require('hasown');
var defineProperties = require('define-properties');
var callBind = require('call-bind');
var isEnumerable = Object.prototype.propertyIsEnumerable;
var supportsStrictMode = require('has-strict-mode')();
var functionsHaveNames = require('functions-have-names')();

var runTests = require('./tests');

test('shimmed', function (t) {
	t.comment('shimmed: ' + (orig === Array.prototype.findLastIndex ? 'no' : 'yes'));

	t.equal(Array.prototype.findLastIndex.length, 1, 'Array#findLastIndex has a length of 1');
	t.test('Function name', { skip: !functionsHaveNames }, function (st) {
		st.equal(Array.prototype.findLastIndex.name, 'findLastIndex', 'Array#findLastIndex has name "findLastIndex"');
		st.end();
	});

	t.test('enumerability', { skip: !defineProperties.supportsDescriptors }, function (et) {
		et.equal(false, isEnumerable.call(Array.prototype, 'findLastIndex'), 'Array#findLastIndex is not enumerable');
		et.end();
	});

	t.test('bad array/this value', { skip: !supportsStrictMode }, function (st) {
		st['throws'](function () { return Array.prototype.findLastIndex.call(undefined, function () {}); }, TypeError, 'undefined is not an object');
		st['throws'](function () { return Array.prototype.findLastIndex.call(null, function () {}); }, TypeError, 'null is not an object');
		st.end();
	});

	t.test('Symbol.unscopables', { skip: typeof Symbol !== 'function' || typeof Symbol.unscopables !== 'symbol' }, function (st) {
		st.ok(hasOwn(Array.prototype[Symbol.unscopables], 'findLastIndex'), 'Array.prototype[Symbol.unscopables] has own `findLastIndex` property');
		st.equal(Array.prototype[Symbol.unscopables].findLastIndex, true, 'Array.prototype[Symbol.unscopables].findLastIndex is true');
		st.end();
	});

	runTests(callBind(Array.prototype.findLastIndex), t);

	t.end();
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  INDX( 	 ³            (   X  è         Û      y          œG    x f     G    9¯-Æ‚eÛ_ÿ.Æ‚eÛ_ÿ.Æ‚eÛ_ÿ.Æ‚eÛ       o               c o n f i g - l o a d e r . d . t s   cH    x b     G    Ë?4Æ‚eÛY5Æ‚eÛY5Æ‚eÛY5Æ‚eÛ       =               c o n f i g - l o a d e r . j s       I    € j     G    bƒ:Æ‚eÛX•;Æ‚eÛX•;Æ‚eÛX•;Æ‚eÛ       ã               c o n f i g - l o a d e r . j s . m a p       ÀI    p `     G    Pk=Æ‚eÛ¢7BÆ‚eÛ¢7BÆ‚eÛ¢7BÆ‚eÛ       d              f i l e s y s t e m . d . t s ]J    p \     G    þÇFÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛÊ¯GÆ‚eÛ       Î               f i l e s y s t e m . j s     òJ    x d     G    PÓJÆ‚eÛåKÆ‚eÛåKÆ‚eÛåKÆ‚eÛ       0               f i l e s y s t e m . j s . m a p     rK    h V     G    nGNÆ‚eÛÛæOÆ‚eÛÛæOÆ‚eÛÛæOÆ‚eÛÀ      ½              
 i n d e x . d . t s   ÕK    h R     G    WRÆ‚eÛ%&SÆ‚eÛ%&SÆ‚eÛ%&SÆ‚eÛ       ^               i n d e x . j s       %L    p Z     G    ×ÂSÆ‚eÛNóUÆ‚e NóUÆ‚eÛNóUÆ‚eÛ8      1               i n d e x . j s . m a p       pL    x f     G    iÿWÆ‚eÛ 5YÆ‚eÛ 5YÆ‚eÛ 5YÆ‚eÛˆ      ˆ               m a p p i n g - e n t r y . d . t s   ÅL    x b     G    ¨¸[Æ‚eÛ¨¸[Æ‚eÛ¨¸[Æ‚eÛ¨¸[Æ‚eÛ       0               m a p p i n g - e n t r y . j s       M    € j     G    `®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛ       Ñ               m a p p i n g - e n t r y . j s . m a p       4M    € l     G    —;_Æ‚eÛ—;_Æ‚eÛ—;_Æ‚eÛ—;_Æ‚eÛ       B              m a t c h - p a t h - a s y n c . d . t s     ZM    x h     G    ª1`Æ‚eÛª1`Æ‚eÛª1`Æ‚eÛª1`Æ‚eÛ        ~               m a t c h - p a t h - a s y n c . j s M    € p     G    ª1`Æ‚eÛ•0bÆ‚eÛ•0bÆ‚eÛ•0bÆ‚eÛ       È               m a t c h - p a t h - a s y n c . j s . m a p ªM    € j     G    1ŸbÆ‚eÛ1ŸbÆ‚eÛ1ŸbÆ‚eÛ1ŸbÆ‚eÛ       6               m a t c h - p a t h - s y n c . d . t s       ÊM    x f     G    éúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛ        Ë              m a t c h - p a t h - s y n c . j s   èM    € n     G    éúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛ       >	               m a t c h - p a t h - s y n c . j s . m a p   
N    p Z     G    éúcÆ‚eÛQNfÆ‚eÛQNfÆ‚eÛQNfÆ‚eÛX       U                o p t i o n s . d . t s       'N    h V     G    :gÆ‚eÛ:gÆ‚eÛ:gÆ‚eÛ:gÆ‚eÛˆ      ‚              
 o p t i o n s . j s   DN    p ^     G    :gÆ‚eÛ:gÆ‚eÛ:gÆ‚eÛ:gÆ‚eÛ¨      ¥               o p t i o n s . j s . m a p   \N    p \    G    ÄhÆ‚eÛÄhÆ‚eÛÄhÆ‚eÛÄhÆ‚eÛ      
               r e g i s t e r . d . t s     qN    h X     G    3¦iÆ‚eÛ3¦iÆ‚eÛ3¦iÆ‚eÛ3¦iÆ‚eÛ                      r e g i s t e r . j s ŠN    p `     G    	jÆ‚eÛ	jÆ‚eÛ	jÆ‚eÛ	jÆ‚eÛ       q               r e g i s t e r . j s . m a p ¢N    p \     G    ½okÆ‚eÛ½okÆ‚eÛ½okÆ‚eÛ½okÆ‚eÛ       0               t r y - p a t h . d . t s     ¸N    h X     G    =UlÆ‚eÛ=UlÆ‚eÛ=UlÆ‚eÛ=UlÆ‚eÛ       ²               t r  - p a t h . j s ÎN    p `     G    §êlÆ‚eÛAmmÆ‚eÛAmmÆ‚eÛAmmÆ‚eÛ       Õ
               t r y - p a t h . j s . m a p äN    € j     G    ý÷mÆ‚eÛ=nÆ‚eÛ=nÆ‚eÛ=nÆ‚eÛ       #               t s c o n f i g - l o a d e r . d . t s       úN    x f     G    =nÆ‚eÛa{oÆ‚eÛa{oÆ‚eÛ¡˜ˆSŒeÛ        ;               t s c o n f i g - l o a d e r . j s   O    € n     G    ™pÆ‚eÛXxpÆ‚eÛXxpÆ‚eÛXxpÆ‚eÛ                       t s c o n f i g - l o a d e r . j s . m a p   óO    h T     G    £‰xÆ‚eÛè¾…Æ‚eÛè¾…Æ‚eÛú´MeÛ                       	 _ _ t e s t s _ _                                                                                                                                                                                                                                                                                                                                                                                                                                  /**
 * Error to represent when a method is missing on an impl.
 */
export class NoSuchMethodError extends Error {
    /**
     * Creates a new instance.
     * @param {string} methodName The name of the method that was missing.
     */
    constructor(methodName: string);
}
/**
 * Error to represent when a method is not supported on an impl. This happens
 * when a method on `Hfs` is called with one name and the corresponding method
 * on the impl has a different name. (Example: `text()` and `bytes()`.)
 */
export class MethodNotSupportedError extends Error {
    /**
     * Creates a new instance.
     * @param {string} methodName The name of the method that was missing.
     */
    constructor(methodName: string);
}
/**
 * Error to represent when an impl is already set.
 */
export class ImplAlreadySetError extends Error {
    /**
     * Creates a new instance.
     */
    constructor();
}
/**
 * A class representing a log entry.
 */
export class LogEntry {
    /**
     * Creates a new instance.
     * @param {string} type The type of log entry.
     * @param {any} [data] The data associated with the log entry.
     */
    constructor(type: string, data?: any);
    /**
     * The type of log entry.
     * @type {string}
     */
    type: string;
    /**
     * The data associated with the log entry.
     * @type {any}
     */
    data: any;
    /**
     * The time at which the log entry was created.
     * @type {number}
     */
    timestamp: number;
}
/**
 * A class representing a file system utility library.
 * @implements {HfsImpl}
 */
export class Hfs implements HfsImpl {
    /**
     * Creates a new instance.
     * @param {object} options The options for the instance.
     * @param {HfsImpl} options.impl The implementation to use.
     */
    constructor({ impl }: {
        impl: HfsImpl;
    });
    /**
     * Starts a new log with the given name.
     * @param {string} name The name of the log to start;
     * @returns {void}
     * @throws {Error} When the log already exists.
     * @throws {TypeError} When the name is not a non-empty string.
     */
    logStart(name: string): void;
    /**
     * Ends a log with the given name and returns the entries.
     * @param {string} name The name of the log to end.
     * @returns {Array<LogEntry>} The entries in the log.
     * @throws {Error} When the log does not exist.
     */
    logEnd(name: string): Array<LogEntry>;
    /**
     * Determines if the current implementation is the base implementation.
     * @returns {boolean} True if the current implementation is the base implementation.
     */
    isBaseImpl(): boolean;
    /**
     * Sets the implementation for this instance.
     * @param {object} impl The implementation to use.
     * @returns {void}
     */
    setImpl(impl: object): void;
    /**
     * Resets the implementation for this instance back to its original.
     * @returns {void}
     */
    resetImpl(): void;
    /**
     * Reads the given file and returns the contents as text. Assumes UTF-8 encoding.
     * @param {string|URL} filePath The file to read.
     * @returns {Promise<string|undefined>} The contents of the file.
     * @throws {NoSuchMethodError} When the method does not exist on the current implementation.
     * @throws {TypeError} When the file path is not a non-empty string.
     */
    text(filePath: string | URL): Promise<string | undefined>;
    /**
     * Reads the given file and returns the contents as JSON. Assumes UTF-8 encoding.
     * @param {string|URL} filePath The file to read.
     * @returns {Promise<any|undefined>} The contents of the file as JSON.
     * @throws {NoSuchMethodError} When the method does not exist on the current implementation.
     * @throws {SyntaxError} When the file contents are not valid JSON.
     * @throws {TypeError} When the file path is not a non-empty string.
     */
    json(filePath: string | URL): Promise<any | undefined>;
    /**
     * Reads the given file and returns the contents as an ArrayBuffer.
     * @param {string|URL} filePath The file to read.
     * @returns {Promise<ArrayBu/*
  Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

import {
    BlockScope,
    CatchScope,
    ClassFieldInitializerScope,
    ClassStaticBlockScope,
    ClassScope,
    ForScope,
    FunctionExpressionNameScope,
    FunctionScope,
    GlobalScope,
    ModuleScope,
    SwitchScope,
    WithScope
} from "./scope.js";
import { assert } from "./assert.js";

/**
 * @constructor ScopeManager
 */
class ScopeManager {
    constructor(options) {
        this.scopes = [];
        this.globalScope = null;
        this.__nodeToScope = new WeakMap();
        this.__currentScope = null;
        this.__options = options;
        this.__declaredVariables = new WeakMap();
    }

    __isOptimistic() {
        return this.__options.optimistic;
    }

    __ignoreEval() {
        return this.__options.ignoreEval;
    }

    isGlobalReturn() {
        return this.__options.nodejsScope || this.__options.sourceType === "commonjs";
    }

    isModule() {
        return this.__options.sourceType === "module";
    }

    isImpliedStrict() {
        return this.__options.impliedStrict;
    }

    isStrictModeSupported() {
        return this.__options.ecmaVersion >= 5;
    }

    // Returns appropriate scope for this node.
    __get(node) {
        return this.__nodeToScope.get(node);
    }

    /**
     * Get variables that are declared by the node.
     *
     * "are declared by the node" means the node is same as `Variable.defs[].node` or `Variable.defs[].parent`.
     * If the node declares nothing, this method returns an empty array.
     * CAUTION: This API is experimental. See https://github.com/estools/escope/pull/69 for more details.
     * @param {Espree.Node} node a node to get.
     * @returns {Variable[]} variables that declared by the node.
     */
    getDeclaredVariables(node) {
        return this.__declaredVariables.get(node) || [];
    }

    /**
     * acquire scope from node.
     * @function ScopeManager#acquire
     * @param {Espree.Node} node node for the acquired scope.
     * @param {?boolean} [inner=false] look up the most inner scope, default value is false.
     * @returns {Scope?} Scope from node
     */
    acquire(node, inner) {

        /**
         * predicate
         * @param {Scope} testScope scope to test
         * @returns {boolean} predicate
         */
        function predicate(testScope) {
            if (testScope.type === "function" && testScope.functionExpressionScope) {
                return false;
            }
            return true;
        }

        const scopes = this.__get(node);

        if (!scopes || scopes.length === 0) {
            return null;
        }

        // Heuristic selection from all scopes.
        // If you would like to get all scopes, please use ScopeManager#acquireAll.
        if (scopes.length === 1) {
            return scopes[0];
        }

        if (inner) {
            for (let i = scopes.length - 1; i >= 0; --i) {
                const scope = scopes[i];

                if (predicate(scope)) {
                    return scope;
                }
            }
        } else {
            for (let i = 0, iz = scopes.length; i < iz; ++i) {
                const scope = scopes[i];

                if (predicate(scope)) {
                    return scope;
                }
            }
        }

        return null;
    }

    /**
     * acquire all scopes from node.
     * @function ScopeManager#acquireAll
     * @param {Espree.Node} node node for the acquired scope.
     * @returns {Scopes?} Scope array
     */
    acquireAll(node) {
        return this.__get(node);
    }

    /**
     * release the node.
     * @function ScopeManager#release
     * @param {Espree.Node} node releasing node.
     * @param {?boolean} [inner=false] look up the most inner scope, default value is false.
     * @returns {Scope?} upper scope for the node.
     */
    release(node, inner) {
        const scopes = this.__get(node);

        if (scopes && scopes.length) {
            const scope = scopes[0].upper;

            if (!scope) {
                return null;
            }
            return this.acquire(scope.block, inner);
        }
        return null;
    }

    attach() { } // eslint-disable-line class-methods-use-this -- Desired as instance method

    detach() { } // eslint-disable-line class-methods-use-this -- Desired as instance method

    __nestScope(scope) {
        if (scope instanceof GlobalScope) {
            assert(this.__currentScope === null);
            this.globalScope = scope;
        }
        this.__currentScope = scope;
        return scope;
    }

    __nestGlobalScope(node) {
        return this.__nestScope(new GlobalScope(this, node));
    }

    __nestBlockScope(node) {
        return this.__nestScope(new BlockScope(this, this.__currentScope, node));
    }

    __nestFunctionScope(node, isMethodDefinition) {
        return this.__nestScope(new FunctionScope(this, this.__currentScope, node, isMethodDefinition));
    }

    __nestForScope(node) {
        return this.__nestScope(new ForScope(this, this.__currentScope, node));
    }

    __nestCatchScope(node) {
        return this.__nestScope(new CatchScope(this, this.__currentScope, node));
    }

    __nestWithScope(node) {
        return this.__nestScope(new WithScope(this, this.__currentScope, node));
    }

    __nestClassScope(node) {
        return this.__nestScope(new ClassScope(this, this.__currentScope, node));
    }

    __nestClassFieldInitializerScope(node) {
        return this.__nestScope(new ClassFieldInitializerScope(this, this.__currentScope, node));
    }

    __nestClassStaticBlockScope(node) {
        return this.__nestScope(new ClassStaticBlockScope(this, this.__currentScope, node));
    }

    __nestSwitchScope(node) {
        return this.__nestScope(new SwitchScope(this, this.__currentScope, node));
    }

    __nestModuleScope(node) {
        return this.__nestScope(new ModuleScope(this, this.__currentScope, node));
    }

    __nestFunctionExpressionNameScope(node) {
        return this.__nestScope(new FunctionExpressionNameScope(this, this.__currentScope, node));
    }

    __isES6() {
        return this.__options.ecmaVersion >= 6;
    }
}

export default ScopeManager;

/* vim: set sw=4 ts=4 et tw=80 : */
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            # is-map <sup>[![Version Badge][2]][1]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![dependency status][5]][6]
[![dev dependency status][7]][8]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][11]][1]

Is this value a JS Map? This module works cross-realm/iframe, and despite ES6 @@toStringTag.

## Example

```js
var isMap = require('is-map');
assert(!isMap(function () {}));
assert(!isMap(null));
assert(!isMap(function* () { yield 42; return Infinity; });
assert(!isMap(Symbol('foo')));
assert(!isMap(1n));
assert(!isMap(Object(1n)));

assert(!isMap(new Set()));
assert(!isMap(new WeakSet()));
assert(!isMap(new WeakMap()));

assert(isMap(new Map()));

class MyMap extends Map {}
assert(isMap(new MyMap()));
```

## Tests
Simply clone the repo, `npm install`, and run `npm test`

[1]: https://npmjs.org/package/is-map
[2]: https://versionbadg.es/inspect-js/is-map.svg
[5]: https://david-dm.org/inspect-js/is-map.svg
[6]: https://david-dm.org/inspect-js/is-map
[7]: https://david-dm.org/inspect-js/is-map/dev-status.svg
[8]: https://david-dm.org/inspect-js/is-map#info=devDependencies
[11]: https://nodei.co/npm/is-map.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/is-map.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/is-map.svg
[downloads-url]: https://npm-stat.com/charts.html?package=is-map
[codecov-image]: https://codecov.io/gh/inspect-js/is-map/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/inspect-js/is-map/
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/inspect-js/is-map
[actions-url]: https://github.com/inspect-js/is-map/actions
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                [`3e6b860`](https://github.com/inspect-js/is-generator-function/commit/3e6b8603453e4d127cd1acef720f1ce214d8f69a)
- [Refactor] remove useless `Object#toString` check. [`9d4d7ac`](https://github.com/inspect-js/is-generator-function/commit/9d4d7ac23f6f2f75098903b4fe4f74e1d39a2226)
- [Dev Deps] Update `tape`, `eslint` [`34673b8`](https://github.com/inspect-js/is-generator-function/commit/34673b86aecddf149284bd8bbca5ab54e6e59694)
- Test up to `io.js` `v2.1` [`1e91585`](https://github.com/inspect-js/is-generator-function/commit/1e915850246cbd691606567850f35665a650e490)
- Test on two latest `io.js` versions. [`8702608`](https://github.com/inspect-js/is-generator-function/commit/87026087a1e3b43ba9f8dc7a5b6c2b58d572ff25)
- Test on `iojs-v1.5` and `iojs-v1.6` [`c74935e`](https://github.com/inspect-js/is-generator-function/commit/c74935ec9c187e9640f862607873aa096ddcf9fc)
- Latest `node` now supports generators. [`beb3bfe`](https://github.com/inspect-js/is-generator-function/commit/beb3bfe3d425cc0ece9a02e286727e36d53f5050)
- [Dev Deps] update `tape` [`c6e6587`](https://github.com/inspect-js/is-generator-function/commit/c6e658765c94b9edc282848f13e7bce882711c8c)
- Switch from vb.teelaun.ch to versionbadg.es for the npm version badge SVG. [`0039875`](https://github.com/inspect-js/is-generator-function/commit/0039875e6c587255470088c7867cfa314713626b)
- Test on `io.js` `v2.5` [`0017408`](https://github.com/inspect-js/is-generator-function/commit/001740801d2a29f9a25a8824b064286910601e8c)
- Test on `io.js` `v2.4` [`bc013e2`](https://github.com/inspect-js/is-generator-function/commit/bc013e20b99a89b3f592038196d69f871b39caf0)
- Test on `io.js` `v3.0` [`e195030`](https://github.com/inspect-js/is-generator-function/commit/e1950306f4e0a107101e9aeae89cfac2c18e33de)

## [v1.0.4](https://github.com/inspect-js/is-generator-function/compare/v1.0.3...v1.0.4) - 2015-03-03

### Fixed

- Add support for detecting concise generator methods. [`#2`](https://github.com/inspect-js/is-generator-function/issues/2)

### Commits

- All grade A-supported `node`/`iojs` versions now ship with an `npm` that understands `^`. [`6562e80`](https://github.com/inspect-js/is-generator-function/commit/6562e8015cf318056522a39d7a8e6ad121f9cf4c)
- Run `travis-ci` tests on `iojs` and `node` v0.12; speed up builds; allow 0.8 failures. [`592f768`](https://github.com/inspect-js/is-generator-function/commit/592f76853bcc5b46351d8842df7fd1483214d870)
- Test on latest `io.js` [`edca329`](https://github.com/inspect-js/is-generator-function/commit/edca329a4b3ddc19b5ac9491f7678240a73f4e0b)
- Forgot to add `replace` in 209fac444b4bd90eaa8df279457c4a15e6bba6d2 [`3ebfb38`](https://github.com/inspect-js/is-generator-function/commit/3ebfb380c73e29447689f0924248a5c801260371)
- Update `semver` [`c21baa5`](https://github.com/inspect-js/is-generator-function/commit/c21baa5acfe51e6bbe324c13ce5d4b6770ecfb27)
- Update `jscs` [`71a68f4`](https://github.com/inspect-js/is-generator-function/commit/71a68f47044af23ed2cd819d122202a59c2e6967)
- Update `tape` [`32c03cf`](https://github.com/inspect-js/is-generator-function/commit/32c03cf5701634f47c8d47fc383c97365adb3bb3)

## [v1.0.3](https://github.com/inspect-js/is-generator-function/compare/v1.0.2...v1.0.3) - 2015-01-31

### Commits

- `make release` [`209fac4`](https://github.com/inspect-js/is-generator-function/commit/209fac444b4bd90eaa8df279457c4a15e6bba6d2)
- Run tests against a faked @@toStringTag [`c9ba1ea`](https://github.com/inspect-js/is-generator-function/commit/c9ba1ea8163bd2e7a0f537da8fbaead0efa96a24)
- Add `sudo: false` to speed up travis-ci tests. [`a4b41e1`](https://github.com/inspect-js/is-generator-function/commit/a4b41e1b9c3856c671922f64bf5b7b41eb9ec0d6)
- Bail out early when typeof is not "function" [`a62e7a5`](https://github.com/inspect-js/is-generator-function/commit/a62e7a547307f5ba62a39e374f2cc2f46705eabc)

## [v1.0.2](https://github.com/inspect-js/is-generator-function/compare/v1.0.1...v1.0.2) - 2015-01-20

### Commits

- Update `tape`, `jscs` [`354d343`](https://github.com/inspect-js/is-generator-function/commit/354d3437426c274221ad21a2a580e9f31bfb07e3)
- Update `jscs` [`e0b6203`](https://github.com/inspect-js/is-generator-function/commit/e0b620323be47b3925fe3cd660c063a06cfde4aa)
- Fix tests in newer v8 (and io.js) [`36f0545`](https://github.com/inspect-js/is-generator-function/commit/36f054590d4f5fa994af5f2e7d592840bf9f9d27)

## [v1.0.1](https://github.com/inspect-js/is-generator-function/compare/v1.0.0...v1.0.1) - 2014-12-14

### Commits

- Use my standard jscs.json file. [`7624ca3`](https://github.com/inspect-js/is-generator-function/commit/7624ca3053cacec69d9a58e40c54e6635d8f980b)
- Use `make-generator-function` instead of a local module. [`9234a57`](https://github.com/inspect-js/is-generator-function/commit/9234a5771a3237baf3fe609540e74ce982fe6932)
- Adding license and downloads badges [`9463b6a`](https://github.com/inspect-js/is-generator-function/commit/9463b6a0c6bf254e213a2f5306f37e9849c8bb1a)
- Using single quotes exclusively. [`4b4d71f`](https://github.com/inspect-js/is-generator-function/commit/4b4d71f9e0d3753b6f2bd764ae910601352ff19e)
- Use SVG badges instead of PNG [`eaaaf41`](https://github.com/inspect-js/is-generator-function/commit/eaaaf41900c2e69c801062e8c7bb247bd3d2e402)
- Updating jscs. [`780758e`](https://github.com/inspect-js/is-generator-function/commit/780758ef1ae5e6a7a422fc8e3ac1265f53e33135)
- Update `tape`, `jscs` [`6b8f959`](https://github.com/inspect-js/is-generator-function/commit/6b8f95928274d770e9b66359e38c982a2b161e74)
- Update `tape`, `jscs` [`6e1334d`](https://github.com/inspect-js/is-generator-function/commit/6e1334d12899bed116ab3c4e82994fdfc8f8c279)
- Lock covert to v1.0.0. [`3dd5c74`](https://github.com/inspect-js/is-generator-function/commit/3dd5c74921a59481d5a699444a879ef0f80ef7c5)
- Updating `tape` [`99f61a3`](https://github.com/inspect-js/is-generator-function/commit/99f61a30692b7c00d06a6d29ac3022b242d4f1d4)
- Updating jscs [`171d96d`](https://github.com/inspect-js/is-generator-function/commit/171d96deef2bff8a840b0ef9563ad9366c8fcd98)
- Updating jscs [`847795e`](https://github.com/inspect-js/is-generator-function/commit/847795e9f951f5d28195f0bdb85ec26b427d2d33)
- Updating jscs [`cad09d8`](https://github.com/inspect-js/is-generator-function/commit/cad09d88873f2595545977f0ce9ed8ccde78b625)
- Updating covert [`8617860`](https://github.com/inspect-js/is-generator-function/commit/86178604dccea5b73ad2b386b275657366735529)
- Adding an .nvmrc file. [`1fa3ea4`](https://github.com/inspect-js/is-generator-function/commit/1fa3ea4f04139fdc28e2c0e553efd917be1f5744)

## [v1.0.0](https://github.com/inspect-js/is-generator-function/compare/v0.0.0...v1.0.0) - 2014-08-09

### Commits

- Adding `npm run lint` [`ed9cf0a`](https://github.com/inspect-js/is-generator-function/commit/ed9cf0a240ae8b3c4bf682e5ff37757d9eb6cffc)
- Make sure old and unstable nodes don't break Travis [`80a7ee7`](https://github.com/inspect-js/is-generator-function/commit/80a7ee782dc832869bccf857213ef76685303738)
- Updating tape [`d5f141f`](https://github.com/inspect-js/is-generator-function/commit/d5f141f0017aefb003911a1eb9c9b615069f1cf0)
- Fix npm upgrading on node 0.8 [`2ee0f08`](https://github.com/inspect-js/is-generator-function/commit/2ee0f08a56f493fb5d4299c7bda9cd52c41a98a2)
- Updating dependencies [`accf688`](https://github.com/inspect-js/is-generator-function/commit/accf688e8c20f05d0f24c1ff8efdaa24def0882c)
- Updating covert [`38d22e6`](https://github.com/inspect-js/is-generator-function/commit/38d22e6cdc939bb3f2cbfc5fff41473a694d4fe5)
- Updating tape [`49c1f00`](https://github.com/inspect-js/is-generator-function/commit/49c1f00cf5c66c87a8678d9c78a6b411cf1af986)
- Updating tape [`75cb7df`](https://github.com/inspect-js/is-generator-function/commit/75cb7dfef5254f4a9941a3bd77471cb783bb6fbd)
- Updating tape [`4142cc0`](https://github.com/inspect-js/is-generator-function/commit/4142cc092e157b92a6107112b2c3f3dc9b154367)
- Better code coverage [`1831d64`](https://github.com/inspect-js/is-generator-function/commit/1831d64d859ae8d45cc9aea30248d8cabc3d1e1d)

## v0.0.0 - 2014-02-09

### Commits

- Tests. [`f46e936`](https://github.com/inspect-js/is-generator-function/commit/f46e9368db04e0725a56e2bd0a246ab52123ed35)
- package.json [`189db32`](https://github.com/inspect-js/is-generator-function/commit/189db324e627257de94b68d1e6005c21ba74ebad)
- Initial commit [`8096cee`](https://github.com/inspect-js/is-generator-function/commit/8096ceedf7c9caece9acfd0ff4a0bd6eafa5dfdf)
- README. [`9eda97f`](https://github.com/inspect-js/is-generator-function/commit/9eda97fbc33113a519121a6515e777985730f3f7)
- Implementation. [`c5c3a8d`](https://github.com/inspect-js/is-generator-function/commit/c5c3a8d5dccae465c69958fc38c4ceba8b1354cc)
- Adding Travis CI [`9a6503e`](https://github.com/inspect-js/is-generator-function/commit/9a6503ebce8c9521c82e8ed1ec1b79bc856d0c5c)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  uriTokens.push(components.query);
    }
    if (components.fragment !== undefined) {
        uriTokens.push("#");
        uriTokens.push(components.fragment);
    }
    return uriTokens.join(""); //merge tokens into a string
}

function resolveComponents(base, relative) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    var skipNormalization = arguments[3];

    var target = {};
    if (!skipNormalization) {
        base = parse(serialize(base, options), options); //normalize base components
        relative = parse(serialize(relative, options), options); //normalize relative components
    }
    options = options || {};
    if (!options.tolerant && relative.scheme) {
        target.scheme = relative.scheme;
        //target.authority = relative.authority;
        target.userinfo = relative.userinfo;
        target.host = relative.host;
        target.port = relative.port;
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
    } else {
        if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
            //target.authority = relative.authority;
            target.userinfo = relative.userinfo;
            target.host = relative.host;
            target.port = relative.port;
            target.path = removeDotSegments(relative.path || "");
            target.query = relative.query;
        } else {
            if (!relative.path) {
                target.path = base.path;
                if (relative.query !== undefined) {
                    target.query = relative.query;
                } else {
                    target.query = base.query;
                }
            } else {
                if (relative.path.charAt(0) === "/") {
                    target.path = removeDotSegments(relative.path);
                } else {
                    if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
                        target.path = "/" + relative.path;
                    } else if (!base.path) {
                        target.path = relative.path;
                    } else {
                        target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
                    }
                    target.path = removeDotSegments(target.path);
                }
                target.query = relative.query;
            }
            //target.authority = base.authority;
            target.userinfo = base.userinfo;
            target.host = base.host;
            target.port = base.port;
        }
        target.scheme = base.scheme;
    }
    target.fragment = relative.fragment;
    return target;
}

function resolve(baseURI, relativeURI, options) {
    var schemelessOptions = assign({ scheme: 'null' }, options);
    return serialize(resolveComponents(parse(baseURI, schemelessOptions), parse(relativeURI, schemelessOptions), schemelessOptions, true), schemelessOptions);
}

function normalize(uri, options) {
    if (typeof uri === "string") {
        uri = serialize(parse(uri, options), options);
    } else if (typeOf(uri) === "object") {
        uri = parse(serialize(uri, options), options);
    }
    return uri;
}

function equal(uriA, uriB, options) {
    if (typeof uriA === "string") {
        uriA = serialize(parse(uriA, options), options);
    } else if (typeOf(uriA) === "object") {
        uriA = serialize(uriA, options);
    }
    if (typeof uriB === "string") {
        uriB = serialize(parse(uriB, options), options);
    } else if (typeOf(uriB) === "object") {
        uriB = serialize(uriB, options);
    }
    return uriA === uriB;
}

function escapeComponent(str, options) {
    return str && str.toString().replace(!options || !options.iri ? URI_PROTOCOL.ESCAPE : IRI_PROTOCOL.ESCAPE, pctEncChar);
}

function unescapeComponent(str, options) {
    return str && str.toString().replace(!options || !options.iri ? URI_PROTOCOL.PCT_ENCODED : IRI_PROTOCOL.PCT_ENCODED, pctDecChars);
}

var handler = {
    scheme: "http",
    domainHost: true,
    parse: function parse(components, options) {
        //report missing host
        if (!components.host) {
            components.error = components.error || "HTTP URIs must have a host.";
        }
        return components;
    },
    serialize: function serialize(components, options) {
        var secure = String(components.scheme).toLowerCase() === "https";
        //normalize the default port
        if (components.port === (secure ? 443 : 80) || components.port === "") {
            components.port = undefined;
        }
        //normalize the empty path
        if (!components.path) {
            components.path = "/";
        }
        //NOTE: We do not parse query strings for HTTP URIs
        //as WWW Form Url Encoded query strings are part of the HTML4+ spec,
        //and not the HTTP spec.
        return components;
    }
};

var handler$1 = {
    scheme: "https",
    domainHost: handler.domainHost,
    parse: handler.parse,
    serialize: handler.serialize
};

function isSecure(wsComponents) {
    return typeof wsComponents.secure === 'boolean' ? wsComponents.secure : String(wsComponents.scheme).toLowerCase() === "wss";
}
//RFC 6455
var handler$2 = {
    scheme: "ws",
    domainHost: true,
    parse: function parse(components, options) {
        var wsComponents = components;
        //indicate if the secure flag is set
        wsComponents.secure = isSecure(wsComponents);
        //construct resouce name
        wsComponents.resourceName = (wsComponents.path || '/') + (wsComponents.query ? '?' + wsComponents.query : '');
        wsComponents.path = undefined;
        wsComponents.query = undefined;
        return wsComponents;
    },
    serialize: function serialize(wsComponents, options) {
        //normalize the default port
        if (wsComponents.port === (isSecure(wsComponents) ? 443 : 80) || wsComponents.port === "") {
            wsComponents.port = undefined;
        }
        //ensure scheme matches secure flag
        if (typeof wsComponents.secure === 'boolean') {
            wsComponents.scheme = wsComponents.secure ? 'wss' : 'ws';
            wsComponents.secure = undefined;
        }
        //reconstruct path from resource name
        if (wsComponents.resourceName) {
            var _wsComponents$resourc = wsComponents.resourceName.split('?'),
                _wsComponents$resourc2 = slicedToArray(_wsComponents$resourc, 2),
                path = _wsComponents$resourc2[0],
                query = _wsComponents$resourc2[1];

            wsComponents.path = path && path !== '/' ? path : undefined;
            wsComponents.query = query;
            wsComponents.resourceName = undefined;
        }
        //forbid fragment component
        wsComponents.fragment = undefined;
        return wsComponents;
    }
};

var handler$3 = {
    scheme: "wss",
    domainHost: handler$2.domainHost,
    parse: handler$2.parse,
    serialize: handler$2.serialize
};

var O = {};
var isIRI = true;
//RFC 3986
var UNRESERVED$$ = "[A-Za-z0-9\\-\\.\\_\\~" + (isIRI ? "\\xA0-\\u200D\\u2010-\\u2029\\u202F-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF" : "") + "]";
var HEXDIG$$ = "[0-9A-Fa-f]"; //case-insensitive
var PCT_ENCODED$ = subexp(subexp("%[EFef]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%[89A-Fa-f]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%" + HEXDIG$$ + HEXDIG$$)); //expanded
//RFC 5322, except these symbols as per RFC 6068: @ : / ? # [ ] & ; =
//const ATEXT$$ = "[A-Za-z0-9\\!\\#\\$\\%\\&\\'\\*\\+\\-\\/\\=\\?\\^\\_\\`\\{\\|\\}\\~]";
//const WSP$$ = "[\\x20\\x09]";
//const OBS_QTEXT$$ = "[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]";  //(%d1-8 / %d11-12 / %d14-31 / %d127)
//const QTEXT$$ = merge("[\\x21\\x23-\\x5B\\x5D-\\x7E]", OBS_QTEXT$$);  //%d33 / %d35-91 / %d93-126 / obs-qtext
//const VCHAR$$ = "[\\x21-\\x7E]";
//const WSP$$ = "[\\x20\\x09]";
//const OBS_QP$ = subexp("\\\\" + merge("[\\x00\\x0D\\x0A]", OBS_QTEXT$$));  //%d0 / CR / LF / obs-qtext
//const FWS$ = subexp(subexp(WSP$$ + "*" + "\\x0D\\x0A") + "?" + WSP$$ + "+");
//const QUOTED_PAIR$ = subexp(subexp("\\\\" + subexp(VCHAR$$ + "|" + WSP$$)) + "|" + OBS_QP$);
//const QUOTED_STRING$ = subexp('\\"' + subexp(FWS$ + "?" + QCONTENT$) + "*" + FWS$ + "?" + '\\"');
var ATEXT$$ = "[A-Za-z0-9\\!\\$\\%\\'\\*\\+\\-\\^\\_\\`\\{\\|\\}\\~]";
var QTEXT$$ = "[\\!\\$\\%\\'\\(\\)\\*\\+\\,\\-\\.0-9\\<\\>A-Z\\x5E-\\x7E]";
var VCHAR$$ = merge(QTEXT$$, "[\\\"\\\\]");
var SOME_DELIMS$$ = "[\\!\\$\\'\\(\\)\\*\\+\\,\\;\\:\\@]";
var UNRESERVED = new RegExp(UNRESERVED$$, "g");
var PCT_ENCODED = new RegExp(PCT_ENCODED$, "g");
var NOT_LOCAL_PART = new RegExp(merge("[^]", ATEXT$$, "[\\.]", '[\\"]', VCHAR$$), "g");
var NOT_HFNAME = new RegExp(merge("[^]", UNRESERVED$$, SOME_DELIMS$$), "g");
var NOT_HFVALUE = NOT_HFNAME;
function decodeUnreserved(str) {
    var decStr = pctDecChars(str);
    return !decStr.match(UNRESERVED) ? str : decStr;
}
var handler$4 = {
    scheme: "mailto",
    parse: function parse$$1(components, options) {
        var mailtoComponents = components;
        var to = mailtoComponents.to = mailtoComponents.path ? mailtoComponents.path.split(",") : [];
        mailtoComponents.path = undefined;
        if (mailtoComponents.query) {
            var unknownHeaders = false;
            var headers = {};
            var hfields = mailtoComponents.query.split("&");
            for (var x = 0, xl = hfields.length; x < xl; ++x) {
                var hfield = hfields[x].split("=");
                switch (hfield[0]) {
                    case "to":
                        var toAddrs = hfield[1].split(",");
                        for (var _x = 0, _xl = toAddrs.length; _x < _xl; ++_x) {
                            to.push(toAddrs[_x]);
                        }
                        break;
                    case "subject":
                        mailtoComponents.subject = unescapeComponent(hfield[1], options);
                        break;
                    case "body":
                        mailtoComponents.body = unescapeComponent(hfield[1], options);
                        break;
                    default:
                        unknownHeaders = true;
                        headers[unescapeComponent(hfield[0], options)] = unescapeComponent(hfield[1], options);
                        break;
                }
            }
            if (unknownHeaders) mailtoComponents.headers = headers;
        }
        mailtoComponents.query = undefined;
        for (var _x2 = 0, _xl2 = to.length; _x2 < _xl2; ++_x2) {
            var addr = to[_x2].split("@");
            addr[0] = unescapeComponent(addr[0]);
            if (!options.unicodeSupport) {
                //convert Unicode IDN -> ASCII IDN
                try {
                    addr[1] = punycode.toASCII(unescapeComponent(addr[1], options).toLowerCase());
                } catch (e) {
                    mailtoComponents.error = mailtoComponents.error || "Email address's domain name can not be converted to ASCII via punycode: " + e;
                }
            } else {
                addr[1] = unescapeComponent(addr[1], options).toLowerCase();
            }
            to[_x2] = addr.join("@");
        }
        return mailtoComponents;
    },
    serialize: function serialize$$1(mailtoComponents, options) {
        var components = mailtoComponents;
        var to = toArray(mailtoComponents.to);
        if (to) {
            for (var x = 0, xl = to.length; x < xl; ++x) {
                var toAddr = String(to[x]);
                var atIdx = toAddr.lastIndexOf("@");
                var localPart = toAddr.slice(0, atIdx).replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_LOCAL_PART, pctEncChar);
                var domain = toAddr.slice(atIdx + 1);
                //convert IDN via punycode
                try {
                    domain = !options.iri ? punycode.toASCII(unescapeComponent(domain, options).toLowerCase()) : punycode.toUnicode(domain);
                } catch (e) {
                    components.error = components.error || "Email address's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
                }
                to[x] = localPart + "@" + domain;
            }
            components.path = to.join(",");
        }
        var headers = mailtoComponents.headers = mailtoComponents.headers || {};
        if (mailtoComponents.subject) headers["subject"] = mailtoComponents.subject;
        if (mailtoComponents.body) headers["body"] = mailtoComponents.body;
        var fields = [];
        for (var name in headers) {
            if (headers[name] !== O[name]) {
                fields.push(name.replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFNAME, pctEncChar) + "=" + headers[name].replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFVALUE, pctEncChar));
            }
        }
        if (fields.length) {
            components.query = fields.join("&");
        }
        return components;
    }
};

var URN_PARSE = /^([^\:]+)\:(.*)/;
//RFC 2141
var handler$5 = {
    scheme: "urn",
    parse: function parse$$1(components, options) {
        var matches = components.path && components.path.match(URN_PARSE);
        var urnComponents = components;
        if (matches) {
            var scheme = options.scheme || urnComponents.scheme || "urn";
            var nid = matches[1].toLowerCase();
            var nss = matches[2];
            var urnScheme = scheme + ":" + (options.nid || nid);
            var schemeHandler = SCHEMES[urnScheme];
            urnComponents.nid = nid;
            urnComponents.nss = nss;
            urnComponents.path = undefined;
            if (schemeHandler) {
                urnComponents = schemeHandler.parse(urnComponents, options);
            }
        } else {
            urnComponents.error = urnComponents.error || "URN can not be parsed.";
        }
        return urnComponents;
    },
    serialize: function serialize$$1(urnComponents, options) {
        var scheme = options.scheme || urnComponents.scheme || "urn";
        var nid = urnComponents.nid;
        var urnScheme = scheme + ":" + (options.nid || nid);
        var schemeHandler = SCHEMES[urnScheme];
        if (schemeHandler) {
            urnComponents = schemeHandler.serialize(urnComponents, options);
        }
        var uriComponents = urnComponents;
        var nss = urnComponents.nss;
        uriComponents.path = (nid || options.nid) + ":" + nss;
        return uriComponents;
    }
};

var UUID = /^[0-9A-Fa-f]{8}(?:\-[0-9A-Fa-f]{4}){3}\-[0-9A-Fa-f]{12}$/;
//RFC 4122
var handler$6 = {
    scheme: "urn:uuid",
    parse: function parse(urnComponents, options) {
        var uuidComponents = urnComponents;
        uuidComponents.uuid = uuidComponents.nss;
        uuidComponents.nss = undefined;
        if (!options.tolerant && (!uuidComponents.uuid || !uuidComponents.uuid.match(UUID))) {
            uuidComponents.error = uuidComponents.error || "UUID is not valid.";
        }
        return uuidComponents;
    },
    serialize: function serialize(uuidComponents, options) {
        var urnComponents = uuidComponents;
        //normalize UUID
        urnComponents.nss = (uuidComponents.uuid || "").toLowerCase();
        return urnComponents;
    }
};

SCHEMES[handler.scheme] = handler;
SCHEMES[handler$1.scheme] = handler$1;
SCHEMES[handler$2.scheme] = handler$2;
SCHEMES[handler$3.scheme] = handler$3;
SCHEMES[handler$4.scheme] = handler$4;
SCHEMES[handler$5.scheme] = handler$5;
SCHEMES[handler$6.scheme] = handler$6;

exports.SCHEMES = SCHEMES;
exports.pctEncChar = pctEncChar;
exports.pctDecChars = pctDecChars;
exports.parse = parse;
exports.removeDotSegments = removeDotSegments;
exports.serialize = serialize;
exports.resolveComponents = resolveComponents;
exports.resolve = resolve;
exports.normalize = normalize;
exports.equal = equal;
exports.escapeComponent = escapeComponent;
exports.unescapeComponent = unescapeComponent;

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=uri.all.js.map
                                        # is-set <sup>[![Version Badge][npm-version-svg]][package-url]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][npm-badge-png]][package-url]

Is this value a JS Set? This module works cross-realm/iframe, and despite ES6 @@toStringTag.

## Example

```js
var isSet = require('is-set');
assert(!isSet(function () {}));
assert(!isSet(null));
assert(!isSet(function* () { yield 42; return Infinity; });
assert(!isSet(Symbol('foo')));
assert(!isSet(1n));
assert(!isSet(Object(1n)));

assert(!isSet(new Map()));
assert(!isSet(new WeakSet()));
assert(!isSet(new WeakMap()));

assert(isSet(new Set()));

class MySet extends Set {}
assert(isSet(new MySet()));
```

## Tests
Simply clone the repo, `npm install`, and run `npm test`

[package-url]: https://npmjs.org/package/is-set
[npm-version-svg]: https://versionbadg.es/inspect-js/is-set.svg
[deps-svg]: https://david-dm.org/inspect-js/is-set.svg
[deps-url]: https://david-dm.org/inspect-js/is-set
[dev-deps-svg]: https://david-dm.org/inspect-js/is-set/dev-status.svg
[dev-deps-url]: https://david-dm.org/inspect-js/is-set#info=devDependencies
[npm-badge-png]: https://nodei.co/npm/is-set.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/is-set.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/is-set.svg
[downloads-url]: https://npm-stat.com/charts.html?package=is-set
[codecov-image]: https://codecov.io/gh/inspect-js/is-set/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/inspect-js/is-set/
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/inspect-js/is-set
[actions-url]: https://github.com/inspect-js/is-set/actions
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         # is-weakset <sup>[![Version Badge][npm-version-svg]][package-url]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][npm-badge-png]][package-url]

Is this value a JS WeakSet? This module works cross-realm/iframe, and despite ES6 @@toStringTag.

## Example

```js
var isWeakSet = require('is-weakset');
assert(!isWeakSet(function () {}));
assert(!isWeakSet(null));
assert(!isWeakSet(function* () { yield 42; return Infinity; });
assert(!isWeakSet(Symbol('foo')));
assert(!isWeakSet(1n));
assert(!isWeakSet(Object(1n)));

assert(!isWeakSet(new Set()));
assert(!isWeakSet(new WeakMap()));
assert(!isWeakSet(new Map()));

assert(isWeakSet(new WeakSet()));

class MyWeakSet extends WeakSet {}
assert(isWeakSet(new MyWeakSet()));
```

## Tests
Simply clone the repo, `npm install`, and run `npm test`

[package-url]: https://npmjs.org/package/is-weakset
[npm-version-svg]: https://versionbadg.es/inspect-js/is-weakset.svg
[deps-svg]: https://david-dm.org/inspect-js/is-weakset.svg
[deps-url]: https://david-dm.org/inspect-js/is-weakset
[dev-deps-svg]: https://david-dm.org/inspect-js/is-weakset/dev-status.svg
[dev-deps-url]: https://david-dm.org/inspect-js/is-weakset#info=devDependencies
[npm-badge-png]: https://nodei.co/npm/is-weakset.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/is-weakset.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/is-weakset.svg
[downloads-url]: https://npm-stat.com/charts.html?package=is-weakset
[codecov-image]: https://codecov.io/gh/inspect-js/is-weakset/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/inspect-js/is-weakset/
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/inspect-js/is-weakset
[actions-url]: https://github.com/inspect-js/is-weakset/actions
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = extractValueFromBindExpression;
/**
 * Extractor function for a BindExpression type value node.
 * A bind expression looks like `::this.foo`
 * This will return `this.foo.bind(this)` as the value to indicate its existence,
 * since we can not execute the function this.foo.bind(this) in a static environment.
 *
 * @param - value - AST Value object with type `BindExpression`
 * @returns - The extracted value converted to correct type.
 */
function extractValueFromBindExpression(value) {
  // eslint-disable-next-line global-require
  var getValue = require('.').default;
  var callee = getValue(value.callee);

  // If value.object === null, the callee must be a MemberExpression.
  // https://github.com/babel/babylon/blob/master/ast/spec.md#bindexpression
  var object = value.object === null ? getValue(value.callee.object) : getValue(value.object);

  if (value.object && value.object.property) {
    return object + '.' + callee + '.bind(' + object + ')';
  }

  return callee + '.bind(' + object + ')';
}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         INDX( 	 \ú            (   P  è                            ØF    h R     tB    öÇ&Æ‚eÛ—;_Æ‚eÛ—;_Æ‚eÛï«|MeÛ                        a d a p t e r s s . j ÿL    p ^     tB    `®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛ`®]Æ‚eÛx       v                c o n s t a n t s . d . t s   F    p Z     tB    %FÆ‚eÛ¼ Æ‚eÛ¼ Æ‚eÛªdSŒeÛ       Þ               c o n s t a n t s . j s       ‡M    h V     tB     ÓaÆ‚eÛ•0bÆ‚eÛ•0bÆ‚eÛ•0bÆ‚eÛ       W              
 i n d e x . d . t s   I    h R    tB    ãQ9Æ‚eÛëø:Æ‚eÛëø:Æ‚eÛ„cSŒeÛ       ñ               i n d e x . j s s     ãB    h T     tB    VïÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛï«|MeÛ                       	 p r o v i d e r s     çM    p \     tB    éúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛéúcÆ‚eÛ       š               s e t t i n g s . d . t s     K    h X     tB    åKÆ‚eÛåKÆ‚eÛåKÆ‚eÛ`òdSŒeÛ       4               s e t t i n g s . j s dI    ` L     tB    Pk=Æ‚eÛ1ŸbÆ‚eÛ1ŸbÆ‚eÛï«|MeÛ                        t y p e s     ÜG    ` L     tB    _ÿ.Æ‚eÛéúcÆ‚eÛéúcÆ‚eÛï«|MeÛ                        u t i l s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     # set-proto <sup>[![Version Badge][npm-version-svg]][package-url]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][npm-badge-png]][package-url]

Robustly set the [[Prototype]] of an object. Uses the best available method.

## Getting started

```sh
npm install --save set-proto
```

## Usage/Examples

```js
const assert = require('assert');
const setProto = require('set-proto');

const a = { a: 1, b: 2, [Symbol.toStringTag]: 'foo' };
const b = { c: 3 };

assert.ok(!('c' in a));

setProto(a, b);

assert.ok('c' in a);
```

## Tests

Clone the repo, `npm install`, and run `npm test`

[package-url]: https://npmjs.org/package/set-proto
[npm-version-svg]: https://versionbadg.es/ljharb/set-proto.svg
[deps-svg]: https://david-dm.org/ljharb/set-proto.svg
[deps-url]: https://david-dm.org/ljharb/set-proto
[dev-deps-svg]: https://david-dm.org/ljharb/set-proto/dev-status.svg
[dev-deps-url]: https://david-dm.org/ljharb/set-proto#info=devDependencies
[npm-badge-png]: https://nodei.co/npm/set-proto.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/set-proto.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/set-proto.svg
[downloads-url]: https://npm-stat.com/charts.html?package=set-proto
[codecov-image]: https://codecov.io/gh/ljharb/set-proto/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/ljharb/set-proto/
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/ljharb/set-proto
[actions-url]: https://github.com/ljharb/set-proto/actions
                                                                                                                                                                                                                                                                                