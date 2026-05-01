exports.errorHandler = (err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

exports.notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};
